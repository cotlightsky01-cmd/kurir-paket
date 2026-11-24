import path from "path";
import fs from "fs";
import QRCode from "qrcode";
import pino from "pino";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { buildVariedTemplateMessage } from "../src/utils/templateVariation";
import {
  HOLD_ON_HOLD_GROUP_OPTIONS,
  extractWaGroupInviteCode,
} from "../src/utils/holdGroups";

export type WaConnectionStatus =
  | "disconnected"
  | "connecting"
  | "qr_ready"
  | "connected";

export type AutoSendItemStatus =
  | "pending"
  | "waiting_delay"
  | "sending"
  | "paused"
  | "sent_full"
  | "sent_cod_only"
  | "skipped_chatted"
  | "invalid_phone"
  | "unregistered"
  | "failed"
  | "cancelled";

export interface AutoSendInputItem {
  id: string;
  name: string;
  phone: string;
  cleanPhone?: string;
  address: string;
  cod: string;
  waTemplateSent?: boolean;
  titipLocationName?: string;
}

export interface AutoSendTemplates {
  cod: string;
  nocod: string;
  titip: string;
  codOnlyNoShareloc: string;
}

export interface TempatCodItem {
  id: string;
  name: string;
  targetAddress: string;
}

export interface AutoSendItemResult {
  customerId: string;
  name: string;
  phone: string;
  status: AutoSendItemStatus;
  reason?: string;
  templateType?: "titip" | "cod" | "nocod" | "cod_only";
  sentAt?: number;
}

export interface AutoSendStateSnapshot {
  running: boolean;
  phase: "idle" | "checking" | "waiting_delay" | "sending" | "paused" | "completed" | "stopped";
  total: number;
  processed: number;
  sentFullCount: number;
  sentCodOnlyCount: number;
  skippedCount: number;
  failedCount: number;
  currentCustomerId: string | null;
  currentCustomerName: string | null;
  nextSendAt: number | null;
  delaySeconds: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  lastError: string | null;
  items: Record<string, AutoSendItemResult>;
}

const AUTH_DIR = path.join(process.cwd(), ".wa-auth");
const CHAT_INDEX_FILE = path.join(process.cwd(), ".wa-chat-index.json");
const MIN_DELAY_MS = 10000;
const MAX_DELAY_MS = 20000;

const logger = pino({ level: "silent" });

let sock: WASocket | null = null;
let connectionStatus: WaConnectionStatus = "disconnected";
let currentQrDataUrl: string | null = null;
let currentPairingCode: string | null = null;
let connectedUser: { id: string; name?: string; phone: string } | null = null;
let lastConnectionError: string | null = null;
let isConnecting = false;
let manualDisconnect = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;

// Prior chat tracking (phones + LID resolution)
const knownChattedPhones = new Set<string>();
const lidToPhoneMap = new Map<string, string>();
const pendingChattedLids = new Set<string>();
let saveIndexTimer: ReturnType<typeof setTimeout> | null = null;

// Hold group invite metadata cache
const ALLOWED_HOLD_GROUP_CODES = new Set(
  HOLD_ON_HOLD_GROUP_OPTIONS.map((g) => g.inviteCode)
);
const GROUP_CACHE_TTL_MS = 30 * 60 * 1000;
const groupInviteCache = new Map<
  string,
  { jid: string; subject: string; fetchedAt: number }
>();
const confirmedJoinedGroups = new Set<string>();

// Auto-send queue state
let activeJobToken = 0;
let lastActualSentAt = 0;
let pausedJobContext: {
  items: AutoSendInputItem[];
  templates: AutoSendTemplates;
  tempatCodList: TempatCodItem[];
} | null = null;
let autoSendState: AutoSendStateSnapshot = {
  running: false,
  phase: "idle",
  total: 0,
  processed: 0,
  sentFullCount: 0,
  sentCodOnlyCount: 0,
  skippedCount: 0,
  failedCount: 0,
  currentCustomerId: null,
  currentCustomerName: null,
  nextSendAt: null,
  delaySeconds: null,
  startedAt: null,
  finishedAt: null,
  lastError: null,
  items: {},
};

export function normalizeWaPhone(raw?: string | null): string {
  if (!raw || typeof raw !== "string") return "";
  let digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) {
    digits = "62" + digits.slice(1);
  } else if (digits.startsWith("8")) {
    digits = "62" + digits;
  }
  return digits;
}

export function isValidServerWaPhone(raw?: string | null): boolean {
  const cleaned = normalizeWaPhone(raw);
  if (!cleaned.startsWith("628")) return false;
  if (cleaned.length < 11 || cleaned.length > 14) return false;
  if (!/^628[1235789]/.test(cleaned)) return false;
  if (/^628(\d)\1{7,}$/.test(cleaned)) return false;
  return true;
}

function parseServerCodAmount(codStr?: string): number {
  if (!codStr) return 0;
  const upper = codStr.toUpperCase().trim();
  if (
    upper === "NO COD" ||
    upper === "NO_COD" ||
    upper === "NO" ||
    upper === "TF" ||
    upper === "NON COD" ||
    upper === "LUNAS"
  ) {
    return 0;
  }
  const digits = codStr.replace(/[^\d]/g, "");
  if (!digits) return 0;
  return parseInt(digits, 10) || 0;
}

function getServerRoundedCodFormatted(codStr?: string): string {
  const raw = parseServerCodAmount(codStr);
  if (raw === 0) return "NO COD";
  const remainder = raw % 1000;
  const rounded =
    remainder < 100
      ? Math.floor(raw / 1000) * 1000
      : Math.ceil(raw / 1000) * 1000;
  return "Rp " + rounded.toLocaleString("id-ID");
}

function getMatchingServerTempatCod(
  customerAddress: string,
  locations: TempatCodItem[]
): TempatCodItem | null {
  if (!customerAddress || !Array.isArray(locations) || !locations.length) {
    return null;
  }
  const lowerAddr = customerAddress.toLowerCase();
  for (const loc of locations) {
    if (!loc?.targetAddress) continue;
    const keywords = loc.targetAddress
      .toLowerCase()
      .split(/[,;\r\n\/]+/)
      .map((k) => k.trim())
      .filter(Boolean);
    for (const kw of keywords) {
      if (kw.length >= 2 && lowerAddr.includes(kw)) {
        return loc;
      }
    }
  }
  return null;
}

function loadChatIndexFromDisk() {
  try {
    if (!fs.existsSync(CHAT_INDEX_FILE)) return;
    const raw = fs.readFileSync(CHAT_INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.phones)) {
      for (const p of parsed.phones) {
        const norm = normalizeWaPhone(String(p));
        if (norm.length >= 10) knownChattedPhones.add(norm);
      }
    }
    if (parsed?.lidToPhone && typeof parsed.lidToPhone === "object") {
      for (const [lid, pn] of Object.entries(parsed.lidToPhone)) {
        const norm = normalizeWaPhone(String(pn));
        if (lid && norm.length >= 10) {
          lidToPhoneMap.set(lid, norm);
        }
      }
    }
    if (Array.isArray(parsed?.pendingLids)) {
      for (const l of parsed.pendingLids) {
        if (typeof l === "string" && l.includes("@lid")) {
          pendingChattedLids.add(l);
        }
      }
    }
  } catch {
    // Ignore corrupt index file on startup
  }
}

function scheduleSaveChatIndex() {
  if (saveIndexTimer) return;
  saveIndexTimer = setTimeout(() => {
    saveIndexTimer = null;
    try {
      const data = {
        phones: Array.from(knownChattedPhones),
        lidToPhone: Object.fromEntries(lidToPhoneMap.entries()),
        pendingLids: Array.from(pendingChattedLids).slice(-2000),
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(CHAT_INDEX_FILE, JSON.stringify(data), "utf8");
    } catch {
      // Ignore disk write failure
    }
  }, 500);
}

function cleanJidBase(jid?: string | null): string {
  if (!jid || typeof jid !== "string") return "";
  return jid.replace(/:\d+(?=@)/, "").trim();
}

function extractPhoneFromStandardJid(jid?: string | null): string {
  const cleaned = cleanJidBase(jid);
  if (!cleaned) return "";
  if (
    cleaned.endsWith("@g.us") ||
    cleaned === "status@broadcast" ||
    cleaned.endsWith("@newsletter") ||
    cleaned.endsWith("@broadcast")
  ) {
    return "";
  }
  if (cleaned.endsWith("@s.whatsapp.net") || cleaned.endsWith("@c.us")) {
    const userPart = cleaned.split("@")[0] || "";
    const norm = normalizeWaPhone(userPart);
    return norm.length >= 10 ? norm : "";
  }
  return "";
}

function recordLidMapping(lidRaw?: string | null, pnRaw?: string | null) {
  const lid = cleanJidBase(lidRaw);
  const normPn = normalizeWaPhone(
    pnRaw?.includes("@") ? pnRaw.split("@")[0] : pnRaw
  );
  if (!lid || !lid.endsWith("@lid") || normPn.length < 10) return;

  let changed = false;
  if (lidToPhoneMap.get(lid) !== normPn) {
    lidToPhoneMap.set(lid, normPn);
    changed = true;
  }
  if (pendingChattedLids.has(lid)) {
    pendingChattedLids.delete(lid);
    if (!knownChattedPhones.has(normPn)) {
      knownChattedPhones.add(normPn);
    }
    changed = true;
  }
  if (changed) scheduleSaveChatIndex();
}

function recordChattedJid(jidRaw?: string | null, altJidRaw?: string | null) {
  const jid = cleanJidBase(jidRaw);
  const altJid = cleanJidBase(altJidRaw);

  if (
    !jid ||
    jid.endsWith("@g.us") ||
    jid === "status@broadcast" ||
    jid.endsWith("@newsletter") ||
    jid.endsWith("@broadcast")
  ) {
    return;
  }

  // Skip self chat JID
  if (connectedUser?.phone) {
    const jidPhone = extractPhoneFromStandardJid(jid);
    if (jidPhone && jidPhone === connectedUser.phone) {
      return;
    }
  }

  let changed = false;

  // If altJid carries phone number while jid is LID, store mapping
  const altPhone = extractPhoneFromStandardJid(altJid);
  if (jid.endsWith("@lid") && altPhone) {
    recordLidMapping(jid, altPhone);
  }

  const directPhone = extractPhoneFromStandardJid(jid) || altPhone;
  if (directPhone) {
    if (!knownChattedPhones.has(directPhone)) {
      knownChattedPhones.add(directPhone);
      changed = true;
    }
  } else if (jid.endsWith("@lid")) {
    const mapped = lidToPhoneMap.get(jid);
    if (mapped) {
      if (!knownChattedPhones.has(mapped)) {
        knownChattedPhones.add(mapped);
        changed = true;
      }
    } else if (!pendingChattedLids.has(jid)) {
      pendingChattedLids.add(jid);
      changed = true;
    }
  }

  if (changed) scheduleSaveChatIndex();
}

loadChatIndexFromDisk();

export function hasAuthSessionFiles(): boolean {
  try {
    return fs.existsSync(path.join(AUTH_DIR, "creds.json"));
  } catch {
    return false;
  }
}

export function getWaGatewayStatus() {
  return {
    status: connectionStatus,
    qrDataUrl: currentQrDataUrl,
    pairingCode: currentPairingCode,
    user: connectedUser,
    knownChatsCount: knownChattedPhones.size,
    hasSession: hasAuthSessionFiles(),
    lastError: lastConnectionError,
  };
}

export function getKnownChattedPhonesCount(): number {
  return knownChattedPhones.size;
}

export async function connectWaGateway(): Promise<ReturnType<typeof getWaGatewayStatus>> {
  if (sock && (connectionStatus === "connected" || connectionStatus === "connecting" || connectionStatus === "qr_ready")) {
    return getWaGatewayStatus();
  }
  if (isConnecting) {
    return getWaGatewayStatus();
  }

  isConnecting = true;
  manualDisconnect = false;
  lastConnectionError = null;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    connectionStatus = "connecting";
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    let version: [number, number, number] | undefined;
    try {
      const latest = await fetchLatestBaileysVersion();
      version = latest.version;
    } catch {
      version = undefined;
    }

    const socket = makeWASocket({
      ...(version ? { version } : {}),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger as any),
      },
      logger: logger as any,
      browser: Browsers.ubuntu("Chrome"),
      syncFullHistory: true,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
    });

    sock = socket;

    socket.ev.on("creds.update", async () => {
      try {
        await saveCreds();
      } catch {
        // Ignore creds write warning
      }
    });

    socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          currentQrDataUrl = await QRCode.toDataURL(qr, {
            width: 280,
            margin: 2,
            color: { dark: "#111111", light: "#FFFFFF" },
          });
          connectionStatus = "qr_ready";
          lastConnectionError = null;
        } catch {
          currentQrDataUrl = null;
        }
      }

      if (connection === "open") {
        reconnectAttempts = 0;
        connectionStatus = "connected";
        currentQrDataUrl = null;
        currentPairingCode = null;
        lastConnectionError = null;
        const meId = socket.user?.id || "";
        const mePhone = normalizeWaPhone(meId.split("@")[0]?.split(":")[0] || "");
        connectedUser = {
          id: meId,
          name: socket.user?.name || "WhatsApp Kurir",
          phone: mePhone,
        };
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        sock = null;
        connectedUser = null;
        currentQrDataUrl = null;

        if (isLoggedOut) {
          connectionStatus = "disconnected";
          currentPairingCode = null;
          lastConnectionError = "Sesi WhatsApp logout. Silakan scan QR atau pairing ulang.";
          stopAutoSendQueue("Sesi WhatsApp terputus (logout).");
          try {
            if (fs.existsSync(AUTH_DIR)) {
              fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            }
          } catch {
            // Ignore cleanup failure
          }
          return;
        }

        if (manualDisconnect) {
          connectionStatus = "disconnected";
          return;
        }

        // Reconnect cleanly on transient stream drops (e.g. 515 restart required after QR scan)
        if (hasAuthSessionFiles() && reconnectAttempts < 5) {
          reconnectAttempts++;
          connectionStatus = "connecting";
          const backoffMs = Math.min(8000, 1500 * reconnectAttempts);
          reconnectTimer = setTimeout(() => {
            void connectWaGateway();
          }, backoffMs);
        } else {
          connectionStatus = "disconnected";
          if (statusCode) {
            lastConnectionError = `Koneksi terputus (kode ${statusCode}).`;
          }
        }
      }
    });

    socket.ev.on("messaging-history.set", ({ chats, contacts, messages, lidPnMappings }) => {
      if (Array.isArray(lidPnMappings)) {
        for (const m of lidPnMappings) {
          recordLidMapping(m?.lid, m?.pn);
        }
      }
      if (Array.isArray(contacts)) {
        for (const c of contacts) {
          if (c?.lid && (c?.phoneNumber || c?.id?.endsWith("@s.whatsapp.net"))) {
            recordLidMapping(c.lid, c.phoneNumber || c.id);
          }
        }
      }
      if (Array.isArray(chats)) {
        for (const chat of chats) {
          if (chat?.id) {
            recordChattedJid(chat.id);
          }
        }
      }
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          recordChattedJid(msg?.key?.remoteJid, msg?.key?.remoteJidAlt);
        }
      }
    });

    socket.ev.on("lid-mapping.update", (mapping) => {
      recordLidMapping(mapping?.lid, mapping?.pn);
    });

    socket.ev.on("contacts.upsert", (contacts) => {
      for (const c of contacts) {
        if (c?.lid && (c?.phoneNumber || c?.id?.endsWith("@s.whatsapp.net"))) {
          recordLidMapping(c.lid, c.phoneNumber || c.id);
        }
      }
    });

    socket.ev.on("contacts.update", (contacts) => {
      for (const c of contacts) {
        if (c?.lid && (c?.phoneNumber || c?.id?.endsWith("@s.whatsapp.net"))) {
          recordLidMapping(c.lid, c.phoneNumber || c.id);
        }
      }
    });

    socket.ev.on("chats.upsert", (chats) => {
      for (const chat of chats) {
        if (chat?.id) recordChattedJid(chat.id);
      }
    });

    socket.ev.on("chats.update", (chats) => {
      for (const chat of chats) {
        if (chat?.id) recordChattedJid(chat.id);
      }
    });

    socket.ev.on("messages.upsert", ({ messages }) => {
      if (!Array.isArray(messages)) return;
      for (const msg of messages) {
        recordChattedJid(msg?.key?.remoteJid, msg?.key?.remoteJidAlt);
      }
    });
  } catch (err: any) {
    connectionStatus = "disconnected";
    lastConnectionError = err?.message || "Gagal memulai koneksi WhatsApp.";
  } finally {
    isConnecting = false;
  }

  return getWaGatewayStatus();
}

export async function requestWaPairingCode(rawPhone: string): Promise<{ code: string }> {
  const norm = normalizeWaPhone(rawPhone);
  if (!isValidServerWaPhone(norm)) {
    throw new Error("Nomor WhatsApp tidak valid. Gunakan format 08... atau 628...");
  }

  // Ensure a fresh socket is initialized if not connected yet
  if (!sock) {
    await connectWaGateway();
    // Wait briefly for socket websocket handshake readiness
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (!sock) {
    throw new Error("Socket WhatsApp belum siap. Silakan coba lagi.");
  }

  if (connectionStatus === "connected") {
    throw new Error("WhatsApp sudah terhubung.");
  }

  const code = await sock.requestPairingCode(norm);
  currentPairingCode = code;
  return { code };
}

export async function logoutWaGateway(): Promise<ReturnType<typeof getWaGatewayStatus>> {
  manualDisconnect = true;
  stopAutoSendQueue("Koneksi WhatsApp diputus oleh pengguna.");
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    if (sock) {
      await sock.logout();
    }
  } catch {
    try {
      sock?.end(undefined);
    } catch {
      // Ignore socket close error
    }
  }

  sock = null;
  connectionStatus = "disconnected";
  currentQrDataUrl = null;
  currentPairingCode = null;
  connectedUser = null;
  lastConnectionError = null;
  groupInviteCache.clear();
  confirmedJoinedGroups.clear();

  try {
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
  } catch {
    // Ignore auth folder delete error
  }

  return getWaGatewayStatus();
}

export function initWaGatewayOnBoot() {
  if (hasAuthSessionFiles()) {
    void connectWaGateway();
  }
}

export function getAutoSendState(): AutoSendStateSnapshot {
  return {
    ...autoSendState,
    items: { ...autoSendState.items },
  };
}

function isTerminalAutoSendStatus(status?: AutoSendItemStatus): boolean {
  return (
    status === "sent_full" ||
    status === "sent_cod_only" ||
    status === "skipped_chatted" ||
    status === "invalid_phone" ||
    status === "unregistered" ||
    status === "failed"
  );
}

function isQueuePaused(): boolean {
  return autoSendState.phase === "paused";
}

export function pauseAutoSendQueue(reason?: string): AutoSendStateSnapshot {
  activeJobToken++;
  if (autoSendState.running) {
    autoSendState.running = false;
    autoSendState.phase = "paused";
    autoSendState.nextSendAt = null;
    autoSendState.delaySeconds = null;
    autoSendState.lastError = reason || null;
    for (const key of Object.keys(autoSendState.items)) {
      const item = autoSendState.items[key];
      if (item.status === "waiting_delay") {
        autoSendState.items[key] = {
          ...item,
          status: "paused",
          reason: "Dijeda — siap dilanjutkan",
        };
      }
    }
  }
  return getAutoSendState();
}

export function stopAutoSendQueue(reason?: string): AutoSendStateSnapshot {
  activeJobToken++;
  pausedJobContext = null;
  if (autoSendState.running || autoSendState.phase === "paused") {
    autoSendState.running = false;
    autoSendState.phase = "stopped";
    autoSendState.nextSendAt = null;
    autoSendState.delaySeconds = null;
    autoSendState.finishedAt = Date.now();
    if (reason) {
      autoSendState.lastError = reason;
    }
    for (const key of Object.keys(autoSendState.items)) {
      const item = autoSendState.items[key];
      if (
        item.status === "pending" ||
        item.status === "waiting_delay" ||
        item.status === "sending" ||
        item.status === "paused"
      ) {
        autoSendState.items[key] = {
          ...item,
          status: "cancelled",
          reason: reason || "Dihentikan oleh pengguna",
        };
      }
    }
  }
  return getAutoSendState();
}

export function resetAutoSendQueue(): AutoSendStateSnapshot {
  activeJobToken++;
  pausedJobContext = null;
  autoSendState = {
    running: false,
    phase: "idle",
    total: 0,
    processed: 0,
    sentFullCount: 0,
    sentCodOnlyCount: 0,
    skippedCount: 0,
    failedCount: 0,
    currentCustomerId: null,
    currentCustomerName: null,
    nextSendAt: null,
    delaySeconds: null,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    items: {},
  };
  return getAutoSendState();
}

async function waitInterruptible(ms: number, token: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (token !== activeJobToken || !autoSendState.running) {
      return false;
    }
    const remaining = deadline - Date.now();
    await new Promise((r) => setTimeout(r, Math.min(500, Math.max(50, remaining))));
  }
  return token === activeJobToken && autoSendState.running;
}

function buildAutoMessagesForItem(
  item: AutoSendInputItem,
  hasPriorChat: boolean,
  templates: AutoSendTemplates,
  tempatCodList: TempatCodItem[],
  itemIndex: number
): {
  action: "skip" | "send_cod_only" | "send_full";
  text: string;
  templateType?: "titip" | "cod" | "nocod" | "cod_only";
} {
  const codAmount = parseServerCodAmount(item.cod);
  const roundedCod = getServerRoundedCodFormatted(item.cod);
  const safeName = (item.name || "Pelanggan").trim();
  const seed = `${item.id}|${item.phone}|${safeName}`;

  // Rule 1: Already chatted & Non-COD -> skip automatically
  if (hasPriorChat && codAmount === 0) {
    return { action: "skip", text: "" };
  }

  // Rule 2: Already chatted & COD -> send ONLY COD nominal template (no shareloc request)
  if (hasPriorChat && codAmount > 0) {
    const baseAutoTpl =
      (templates.codOnlyNoShareloc || "").trim() ||
      "Permisi kak {Nama}, hari ini ada paket COD nominal {COD} ya. Mohon disiapkan uang pas, terima kasih.";
    const text = buildVariedTemplateMessage({
      category: "cod_only",
      template: baseAutoTpl,
      customerName: safeName,
      codFormatted: roundedCod,
      isNoCod: false,
      customerSeed: seed,
      sequenceIndex: itemIndex,
    });
    return {
      action: "send_cod_only",
      text,
      templateType: "cod_only",
    };
  }

  // Rule 3: Never chatted -> send complete message anchored to Settings templates
  const matchedLoc = item.titipLocationName
    ? { name: item.titipLocationName }
    : getMatchingServerTempatCod(item.address, tempatCodList);

  if (matchedLoc?.name) {
    const text = buildVariedTemplateMessage({
      category: "titip",
      template: templates.titip || "",
      customerName: safeName,
      codFormatted: roundedCod,
      isNoCod: codAmount === 0,
      titipLocationName: matchedLoc.name,
      customerSeed: seed,
      sequenceIndex: itemIndex,
    });
    return {
      action: "send_full",
      text,
      templateType: "titip",
    };
  }

  if (codAmount > 0) {
    const text = buildVariedTemplateMessage({
      category: "cod",
      template: templates.cod || "",
      customerName: safeName,
      codFormatted: roundedCod,
      isNoCod: false,
      customerSeed: seed,
      sequenceIndex: itemIndex,
    });
    return {
      action: "send_full",
      text,
      templateType: "cod",
    };
  }

  const text = buildVariedTemplateMessage({
    category: "nocod",
    template: templates.nocod || "",
    customerName: safeName,
    codFormatted: roundedCod,
    isNoCod: true,
    customerSeed: seed,
    sequenceIndex: itemIndex,
  });
  return {
    action: "send_full",
    text,
    templateType: "nocod",
  };
}

function runAutoSendWorker(
  queueItems: AutoSendInputItem[],
  templates: AutoSendTemplates,
  tempatCodList: TempatCodItem[],
  token: number,
  sequenceOffset: number,
  initialHasSentAnyMessage: boolean
) {
  void (async () => {
    let hasSentAnyMessage = initialHasSentAnyMessage;

    for (let i = 0; i < queueItems.length; i++) {
      const item = queueItems[i];
      const itemIndex = sequenceOffset + i;
      if (token !== activeJobToken || !autoSendState.running) break;

      if (!sock || connectionStatus !== "connected") {
        pauseAutoSendQueue("Koneksi WhatsApp terputus. Tekan Lanjutkan Send setelah terhubung.");
        break;
      }

      autoSendState.currentCustomerId = item.id;
      autoSendState.currentCustomerName = item.name || "Pelanggan";
      autoSendState.phase = "checking";

      const rawPhone = item.cleanPhone || item.phone || "";
      const normPhone = normalizeWaPhone(rawPhone);

      if (!isValidServerWaPhone(normPhone)) {
        autoSendState.items[item.id] = {
          customerId: item.id,
          name: item.name || "Pelanggan",
          phone: item.phone || "",
          status: "invalid_phone",
          reason: "Nomor HP tidak valid untuk WhatsApp",
        };
        autoSendState.failedCount++;
        autoSendState.processed++;
        continue;
      }

      // Check known prior chat status
      let hasPriorChat =
        knownChattedPhones.has(normPhone) || Boolean(item.waTemplateSent);

      // Verify registration + check LID mapping before deciding delay/send
      let targetJid = `${normPhone}@s.whatsapp.net`;
      let isRegistered = true;
      try {
        const waCheck = await sock.onWhatsApp(targetJid);
        const firstCheck = waCheck?.[0];
        if (!firstCheck?.exists) {
          isRegistered = false;
        } else {
          if (firstCheck.jid) {
            targetJid = firstCheck.jid;
          }
          const resolvedLid = cleanJidBase((firstCheck as any).lid);
          if (resolvedLid && resolvedLid.endsWith("@lid")) {
            if (pendingChattedLids.has(resolvedLid)) {
              hasPriorChat = true;
            }
            recordLidMapping(resolvedLid, normPhone);
          }
        }
      } catch {
        // Proceed with standard JID if onWhatsApp query transiently fails
      }

      if (token !== activeJobToken || !autoSendState.running) {
        if (isQueuePaused()) {
          autoSendState.items[item.id] = {
            customerId: item.id,
            name: item.name || "Pelanggan",
            phone: item.phone || "",
            status: "paused",
            reason: "Dijeda — siap dilanjutkan",
          };
        }
        break;
      }

      if (!isRegistered) {
        autoSendState.items[item.id] = {
          customerId: item.id,
          name: item.name || "Pelanggan",
          phone: item.phone || "",
          status: "unregistered",
          reason: "Nomor tidak terdaftar di WhatsApp",
        };
        autoSendState.failedCount++;
        autoSendState.processed++;
        continue;
      }

      const plan = buildAutoMessagesForItem(
        item,
        hasPriorChat,
        templates,
        tempatCodList,
        itemIndex
      );

      if (plan.action === "skip") {
        autoSendState.items[item.id] = {
          customerId: item.id,
          name: item.name || "Pelanggan",
          phone: item.phone || "",
          status: "skipped_chatted",
          reason: "Sudah pernah chat (Non-COD) — dilewati otomatis",
        };
        autoSendState.skippedCount++;
        autoSendState.processed++;
        continue;
      }

      // Apply random 10s - 20s delay BEFORE sending if another message was already sent
      if (hasSentAnyMessage) {
        const elapsedSinceLast = lastActualSentAt > 0 ? Date.now() - lastActualSentAt : MAX_DELAY_MS;
        const targetGapMs =
          MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1));
        const waitMs = elapsedSinceLast >= MIN_DELAY_MS && i === 0
          ? 0
          : Math.max(0, i === 0 ? targetGapMs - elapsedSinceLast : targetGapMs);

        if (waitMs > 0) {
          autoSendState.phase = "waiting_delay";
          autoSendState.nextSendAt = Date.now() + waitMs;
          autoSendState.delaySeconds = Math.max(1, Math.round(waitMs / 1000));
          autoSendState.items[item.id] = {
            customerId: item.id,
            name: item.name || "Pelanggan",
            phone: item.phone || "",
            status: "waiting_delay",
            reason: `Menunggu jeda aman ${autoSendState.delaySeconds} detik`,
          };

          const shouldContinue = await waitInterruptible(waitMs, token);
          if (!shouldContinue) {
            if (isQueuePaused()) {
              autoSendState.items[item.id] = {
                customerId: item.id,
                name: item.name || "Pelanggan",
                phone: item.phone || "",
                status: "paused",
                reason: "Dijeda — siap dilanjutkan",
              };
            }
            break;
          }
        }
      }

      if (!sock || connectionStatus !== "connected") {
        pauseAutoSendQueue("Koneksi WhatsApp terputus saat menunggu antrean.");
        break;
      }

      autoSendState.phase = "sending";
      autoSendState.nextSendAt = null;
      autoSendState.delaySeconds = null;
      autoSendState.items[item.id] = {
        customerId: item.id,
        name: item.name || "Pelanggan",
        phone: item.phone || "",
        status: "sending",
        reason: "Mengirim pesan...",
      };

      try {
        await sock.sendMessage(targetJid, { text: plan.text });
        hasSentAnyMessage = true;
        lastActualSentAt = Date.now();

        if (!knownChattedPhones.has(normPhone)) {
          knownChattedPhones.add(normPhone);
          scheduleSaveChatIndex();
        }

        const resultStatus: AutoSendItemStatus =
          plan.action === "send_cod_only" ? "sent_cod_only" : "sent_full";

        autoSendState.items[item.id] = {
          customerId: item.id,
          name: item.name || "Pelanggan",
          phone: item.phone || "",
          status: resultStatus,
          templateType: plan.templateType,
          sentAt: Date.now(),
          reason:
            plan.action === "send_cod_only"
              ? "Terkirim template COD saja (tanpa shareloc)"
              : "Terkirim pesan lengkap",
        };

        if (plan.action === "send_cod_only") {
          autoSendState.sentCodOnlyCount++;
        } else {
          autoSendState.sentFullCount++;
        }
      } catch (err: any) {
        autoSendState.items[item.id] = {
          customerId: item.id,
          name: item.name || "Pelanggan",
          phone: item.phone || "",
          status: "failed",
          reason: err?.message || "Gagal mengirim pesan WhatsApp",
        };
        autoSendState.failedCount++;
      }

      autoSendState.processed++;

      // If user clicked Pause while this single sendMessage was in-flight,
      // check if all items happen to be finished or keep remaining items paused cleanly.
      if (token !== activeJobToken || !autoSendState.running) {
        const nextItem = queueItems[i + 1];
        if (nextItem && isQueuePaused()) {
          autoSendState.currentCustomerId = nextItem.id;
          autoSendState.currentCustomerName = nextItem.name || "Pelanggan";
        }
        break;
      }
    }

    if (token === activeJobToken && autoSendState.running) {
      autoSendState.running = false;
      autoSendState.phase = "completed";
      autoSendState.currentCustomerId = null;
      autoSendState.currentCustomerName = null;
      autoSendState.nextSendAt = null;
      autoSendState.delaySeconds = null;
      autoSendState.finishedAt = Date.now();
      pausedJobContext = null;
    } else if (isQueuePaused()) {
      // If paused right as the very last item completed, mark overall job completed
      const allProcessed =
        autoSendState.total > 0 && autoSendState.processed >= autoSendState.total;
      if (allProcessed) {
        autoSendState.phase = "completed";
        autoSendState.currentCustomerId = null;
        autoSendState.currentCustomerName = null;
        autoSendState.finishedAt = Date.now();
        pausedJobContext = null;
      }
    }
  })();
}

export function startAutoSendQueue(
  items: AutoSendInputItem[],
  templates: AutoSendTemplates,
  tempatCodList: TempatCodItem[]
): AutoSendStateSnapshot {
  if (connectionStatus !== "connected" || !sock) {
    throw new Error("WhatsApp belum terhubung. Hubungkan WhatsApp terlebih dahulu.");
  }
  if (autoSendState.running) {
    throw new Error("Proses kirim otomatis masih berjalan.");
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Tidak ada daftar paket di modul Sending.");
  }

  const token = ++activeJobToken;
  pausedJobContext = { items, templates, tempatCodList };

  const initialMap: Record<string, AutoSendItemResult> = {};
  for (const item of items) {
    initialMap[item.id] = {
      customerId: item.id,
      name: item.name || "Pelanggan",
      phone: item.phone || "",
      status: "pending",
    };
  }

  autoSendState = {
    running: true,
    phase: "checking",
    total: items.length,
    processed: 0,
    sentFullCount: 0,
    sentCodOnlyCount: 0,
    skippedCount: 0,
    failedCount: 0,
    currentCustomerId: null,
    currentCustomerName: null,
    nextSendAt: null,
    delaySeconds: null,
    startedAt: Date.now(),
    finishedAt: null,
    lastError: null,
    items: initialMap,
  };

  runAutoSendWorker(items, templates, tempatCodList, token, 0, false);

  return getAutoSendState();
}

export function resumeAutoSendQueue(
  latestItems?: AutoSendInputItem[],
  latestTemplates?: AutoSendTemplates,
  latestTempatCodList?: TempatCodItem[]
): AutoSendStateSnapshot {
  if (connectionStatus !== "connected" || !sock) {
    throw new Error("WhatsApp belum terhubung. Hubungkan WhatsApp terlebih dahulu.");
  }
  if (autoSendState.running) {
    throw new Error("Proses kirim otomatis masih berjalan.");
  }
  if (autoSendState.phase !== "paused" || !pausedJobContext) {
    throw new Error("Tidak ada antrean pengiriman yang dijeda.");
  }

  const templates = latestTemplates || pausedJobContext.templates;
  const tempatCodList = latestTempatCodList || pausedJobContext.tempatCodList;
  const sourceItems =
    Array.isArray(latestItems) && latestItems.length > 0
      ? latestItems
      : pausedJobContext.items;

  // Reconcile status map: preserve already-completed/skipped/failed items and queue only remaining items
  const sourceIds = new Set(sourceItems.map((it) => it.id));
  const nextMap: Record<string, AutoSendItemResult> = {};

  for (const [id, prevResult] of Object.entries(autoSendState.items)) {
    if (isTerminalAutoSendStatus(prevResult.status) || sourceIds.has(id)) {
      nextMap[id] = prevResult;
    }
  }

  const remainingQueue: AutoSendInputItem[] = [];
  for (const item of sourceItems) {
    const existing = nextMap[item.id];
    if (existing && isTerminalAutoSendStatus(existing.status)) {
      continue;
    }
    nextMap[item.id] = {
      customerId: item.id,
      name: item.name || "Pelanggan",
      phone: item.phone || "",
      status: "pending",
    };
    remainingQueue.push(item);
  }

  let processedCount = 0;
  let sentFullCount = 0;
  let sentCodOnlyCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  for (const res of Object.values(nextMap)) {
    if (res.status === "sent_full") {
      sentFullCount++;
      processedCount++;
    } else if (res.status === "sent_cod_only") {
      sentCodOnlyCount++;
      processedCount++;
    } else if (res.status === "skipped_chatted") {
      skippedCount++;
      processedCount++;
    } else if (
      res.status === "invalid_phone" ||
      res.status === "unregistered" ||
      res.status === "failed"
    ) {
      failedCount++;
      processedCount++;
    }
  }

  const totalCount = processedCount + remainingQueue.length;
  pausedJobContext = {
    items: sourceItems,
    templates,
    tempatCodList,
  };

  if (remainingQueue.length === 0) {
    autoSendState = {
      ...autoSendState,
      running: false,
      phase: "completed",
      total: totalCount,
      processed: processedCount,
      sentFullCount,
      sentCodOnlyCount,
      skippedCount,
      failedCount,
      currentCustomerId: null,
      currentCustomerName: null,
      nextSendAt: null,
      delaySeconds: null,
      finishedAt: Date.now(),
      lastError: null,
      items: nextMap,
    };
    pausedJobContext = null;
    return getAutoSendState();
  }

  const token = ++activeJobToken;
  autoSendState = {
    ...autoSendState,
    running: true,
    phase: "checking",
    total: totalCount,
    processed: processedCount,
    sentFullCount,
    sentCodOnlyCount,
    skippedCount,
    failedCount,
    currentCustomerId: remainingQueue[0].id,
    currentCustomerName: remainingQueue[0].name || "Pelanggan",
    nextSendAt: null,
    delaySeconds: null,
    finishedAt: null,
    lastError: null,
    items: nextMap,
  };

  const hadPriorSent = sentFullCount + sentCodOnlyCount > 0;
  runAutoSendWorker(
    remainingQueue,
    templates,
    tempatCodList,
    token,
    processedCount,
    hadPriorSent
  );

  return getAutoSendState();
}

export class WaGatewayNotConnectedError extends Error {
  constructor(message = "WhatsApp belum terhubung. Hubungkan WhatsApp terlebih dahulu.") {
    super(message);
    this.name = "WaGatewayNotConnectedError";
  }
}

export class HoldBundlePartialError extends Error {
  buyerSent: boolean;
  groupSent: boolean;
  targetPhone?: string;
  groupSubject?: string;

  constructor(
    message: string,
    details: {
      buyerSent: boolean;
      groupSent: boolean;
      targetPhone?: string;
      groupSubject?: string;
    }
  ) {
    super(message);
    this.name = "HoldBundlePartialError";
    this.buyerSent = details.buyerSent;
    this.groupSent = details.groupSent;
    this.targetPhone = details.targetPhone;
    this.groupSubject = details.groupSubject;
  }
}

function parseImageDataUrl(imageDataUrl: string): {
  imageBuffer: Buffer;
  mimetype: string;
} {
  const match = (imageDataUrl || "").match(
    /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i
  );
  if (!match) {
    throw new Error("Format foto tidak valid (harus JPEG, PNG, atau WEBP).");
  }

  const mimetype =
    match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const imageBuffer = Buffer.from(match[2], "base64");
  if (!imageBuffer.length || imageBuffer.length > 10 * 1024 * 1024) {
    throw new Error("Ukuran foto kosong atau melebihi batas maksimal 10MB.");
  }

  return { imageBuffer, mimetype };
}

async function resolveRegisteredBuyerJid(normPhone: string): Promise<string> {
  if (!sock || connectionStatus !== "connected") {
    throw new WaGatewayNotConnectedError();
  }

  let targetJid = `${normPhone}@s.whatsapp.net`;
  try {
    const waCheck = await sock.onWhatsApp(targetJid);
    const firstCheck = waCheck?.[0];
    if (!firstCheck?.exists) {
      throw new Error(`Nomor tujuan ${normPhone} tidak terdaftar di WhatsApp.`);
    }
    if (firstCheck.jid) {
      targetJid = firstCheck.jid;
    }
  } catch (err: any) {
    if (err?.message?.includes("tidak terdaftar")) {
      throw err;
    }
    // Proceed with standard JID if transient onWhatsApp lookup hiccup occurs
  }
  return targetJid;
}

async function resolveHoldGroupInvite(
  inviteCode: string,
  ensureJoined: boolean
): Promise<{ jid: string; subject: string }> {
  if (!sock || connectionStatus !== "connected") {
    throw new WaGatewayNotConnectedError();
  }
  if (!ALLOWED_HOLD_GROUP_CODES.has(inviteCode)) {
    throw new Error("Link grup On Hold tidak diizinkan atau tidak dikenali.");
  }

  const now = Date.now();
  let cached = groupInviteCache.get(inviteCode);
  if (!cached || now - cached.fetchedAt > GROUP_CACHE_TTL_MS) {
    try {
      const meta = await sock.groupGetInviteInfo(inviteCode);
      if (!meta?.id) {
        throw new Error("Grup WhatsApp tidak ditemukan dari link undangan.");
      }
      cached = {
        jid: meta.id,
        subject: (meta.subject || "").trim() || "Grup On Hold",
        fetchedAt: now,
      };
      groupInviteCache.set(inviteCode, cached);
    } catch (err: any) {
      const rawMsg = err?.message || String(err);
      if (rawMsg.includes("410") || rawMsg.includes("404") || rawMsg.toLowerCase().includes("gone")) {
        throw new Error("Link undangan grup On Hold sudah kedaluwarsa atau dicabut.");
      }
      throw new Error(`Gagal memeriksa grup On Hold: ${rawMsg}`);
    }
  }

  if (ensureJoined && !confirmedJoinedGroups.has(cached.jid)) {
    let isMember = false;
    try {
      const participating = await sock.groupFetchAllParticipating();
      if (participating && participating[cached.jid]) {
        isMember = true;
      }
    } catch {
      // Fallback to groupAcceptInvite attempt below
    }

    if (!isMember) {
      try {
        const joinedJid = await sock.groupAcceptInvite(inviteCode);
        if (joinedJid) {
          cached = { ...cached, jid: joinedJid };
          groupInviteCache.set(inviteCode, cached);
        }
        isMember = true;
      } catch (joinErr: any) {
        const msg = (joinErr?.message || String(joinErr)).toLowerCase();
        const status = joinErr?.output?.statusCode;
        if (status === 409 || msg.includes("already") || msg.includes("conflict")) {
          isMember = true;
        } else if (msg.includes("approval") || status === 403 || status === 401) {
          throw new Error(
            `Akun WA belum bergabung ke grup "${cached.subject}" (memerlukan persetujuan admin). Silakan gabung grup terlebih dahulu.`
          );
        } else {
          throw new Error(
            `Gagal bergabung ke grup "${cached.subject}": ${joinErr?.message || "Akses ditolak"}`
          );
        }
      }
    }

    if (isMember) {
      confirmedJoinedGroups.add(cached.jid);
    }
  }

  return { jid: cached.jid, subject: cached.subject };
}

export async function getHoldGroupsStatus() {
  const isConnected = connectionStatus === "connected" && Boolean(sock);
  const results = [];

  for (const option of HOLD_ON_HOLD_GROUP_OPTIONS) {
    const cached = groupInviteCache.get(option.inviteCode);
    if (cached && Date.now() - cached.fetchedAt <= GROUP_CACHE_TTL_MS) {
      results.push({
        ...option,
        subject: cached.subject,
        jid: cached.jid,
        resolved: true,
      });
      continue;
    }

    if (isConnected) {
      try {
        const info = await resolveHoldGroupInvite(option.inviteCode, false);
        results.push({
          ...option,
          subject: info.subject,
          jid: info.jid,
          resolved: true,
        });
        continue;
      } catch {
        // Ignore transient lookup error per group
      }
    }

    results.push({
      ...option,
      subject: null,
      jid: null,
      resolved: false,
    });
  }

  return results;
}

export async function sendDirectWaMediaMessage(params: {
  targetPhone: string;
  imageDataUrl: string;
  caption: string;
}): Promise<{ targetPhone: string; sentAt: number }> {
  if (connectionStatus !== "connected" || !sock) {
    throw new WaGatewayNotConnectedError();
  }

  const normPhone = normalizeWaPhone(params.targetPhone);
  if (!normPhone || normPhone.length < 9 || normPhone.length > 16) {
    throw new Error("Nomor tujuan WhatsApp tidak valid. Periksa pengaturan nomor tujuan.");
  }

  const { imageBuffer, mimetype } = parseImageDataUrl(params.imageDataUrl);
  const targetJid = await resolveRegisteredBuyerJid(normPhone);

  await sock.sendMessage(targetJid, {
    image: imageBuffer,
    mimetype,
    caption: (params.caption || "").trim(),
  });

  return {
    targetPhone: normPhone,
    sentAt: Date.now(),
  };
}

export async function sendHoldCameraBundle(params: {
  targetPhone: string;
  imageDataUrl: string;
  templateCaption: string;
  groupInviteUrl: string;
  ohReturnCaption: string;
}): Promise<{
  buyerSent: true;
  groupSent: true;
  targetPhone: string;
  groupJid: string;
  groupSubject: string;
  sentAt: number;
}> {
  if (connectionStatus !== "connected" || !sock) {
    throw new WaGatewayNotConnectedError();
  }

  const normPhone = normalizeWaPhone(params.targetPhone);
  if (!isValidServerWaPhone(normPhone)) {
    throw new Error("Nomor terdaftar pelanggan tidak valid untuk WhatsApp.");
  }

  const cleanTemplateCaption = (params.templateCaption || "").trim();
  if (!cleanTemplateCaption) {
    throw new Error("Keterangan template pesan pelanggan masih kosong.");
  }

  const cleanOhReturnCaption = (params.ohReturnCaption || "").trim();
  if (!cleanOhReturnCaption) {
    throw new Error("Keterangan OH / Return masih kosong.");
  }

  const inviteCode = extractWaGroupInviteCode(params.groupInviteUrl);
  if (!inviteCode || !ALLOWED_HOLD_GROUP_CODES.has(inviteCode)) {
    throw new Error("Grup On Hold yang dipilih tidak valid.");
  }

  const { imageBuffer, mimetype } = parseImageDataUrl(params.imageDataUrl);

  // Validate both targets BEFORE sending either message so we avoid partial sends
  const buyerJid = await resolveRegisteredBuyerJid(normPhone);
  const { jid: groupJid, subject: groupSubject } = await resolveHoldGroupInvite(
    inviteCode,
    true
  );

  // 1. Send photo + template caption to customer's registered phone
  await sock.sendMessage(buyerJid, {
    image: imageBuffer,
    mimetype,
    caption: cleanTemplateCaption,
  });

  if (!knownChattedPhones.has(normPhone)) {
    knownChattedPhones.add(normPhone);
    scheduleSaveChatIndex();
  }

  // Brief gap between media messages to avoid socket burst
  await new Promise((r) => setTimeout(r, 1200));

  if (!sock || connectionStatus !== "connected") {
    throw new HoldBundlePartialError(
      `Pesan template ke ${normPhone} terkirim, namun koneksi WA terputus sebelum kirim ke grup "${groupSubject}".`,
      {
        buyerSent: true,
        groupSent: false,
        targetPhone: normPhone,
        groupSubject,
      }
    );
  }

  // 2. Send photo + OH/Return caption to selected On Hold group
  try {
    await sock.sendMessage(groupJid, {
      image: imageBuffer,
      mimetype,
      caption: cleanOhReturnCaption,
    });
  } catch (err: any) {
    throw new HoldBundlePartialError(
      `Pesan ke ${normPhone} terkirim, namun gagal mengirim ke grup "${groupSubject}": ${err?.message || "Gagal kirim grup"}`,
      {
        buyerSent: true,
        groupSent: false,
        targetPhone: normPhone,
        groupSubject,
      }
    );
  }

  return {
    buyerSent: true,
    groupSent: true,
    targetPhone: normPhone,
    groupJid,
    groupSubject,
    sentAt: Date.now(),
  };
}


