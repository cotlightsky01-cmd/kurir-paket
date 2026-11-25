import path from "path";
import fs from "fs";
import zlib from "zlib";
import QRCode from "qrcode";
import pino from "pino";
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  type Firestore,
} from "firebase/firestore";
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
  | "skipped_manual"
  | "skipped_daily_limit"
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
  manualSkipAutoSend?: boolean;
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
  hasPriorChat?: boolean;
  hasSentShareloc?: boolean;
  hasHousePhoto?: boolean;
  sentAt?: number;
}

export interface WaPrecheckStateSnapshot {
  running: boolean;
  total: number;
  completed: number;
  currentCustomerId: string | null;
  currentCustomerName: string | null;
  currentCustomerPhone: string | null;
  checkedPhones: string[];
  startedAt: number | null;
  finishedAt: number | null;
}

export interface AutoSendStateSnapshot {
  running: boolean;
  phase: "idle" | "checking" | "waiting_delay" | "sending" | "paused" | "completed" | "stopped";
  isInitialDelay?: boolean;
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
const CHAT_INDEX_BACKUP_FILE = path.join(process.cwd(), ".wa-chat-index.backup.json");
const MAX_LOCKED_ANCHORS = 6000;
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

// Prior chat, shareloc & house photo tracking (phones + LID resolution)
const knownChattedPhones = new Set<string>();
const knownSharelocPhones = new Set<string>();
const knownHousePhotoPhones = new Set<string>();
const lidToPhoneMap = new Map<string, string>();
const pendingChattedLids = new Set<string>();
const pendingSharelocLids = new Set<string>();
const pendingHousePhotoLids = new Set<string>();
interface ChatHistoryAnchor {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  timestampMs: number;
}
const oldestChatAnchorByPhone = new Map<string, ChatHistoryAnchor>();
const pendingAnchorsByLid = new Map<string, ChatHistoryAnchor>();
const deepHistoryCheckedAt = new Map<string, number>();
const DEEP_HISTORY_COOLDOWN_MS = 15_000;
const onWhatsAppLidCheckedAt = new Map<string, number>();
const historySyncListeners = new Set<() => void>();
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

// Auto-send queue & background precheck state
let activeJobToken = 0;
let lastActualSentAt = 0;
let activeQueueItemsRef: AutoSendInputItem[] | null = null;
let pausedJobContext: {
  items: AutoSendInputItem[];
  templates: AutoSendTemplates;
  tempatCodList: TempatCodItem[];
} | null = null;
let autoSendState: AutoSendStateSnapshot = {
  running: false,
  phase: "idle",
  isInitialDelay: false,
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

let precheckToken = 0;
let precheckState: WaPrecheckStateSnapshot = {
  running: false,
  total: 0,
  completed: 0,
  currentCustomerId: null,
  currentCustomerName: null,
  currentCustomerPhone: null,
  checkedPhones: [],
  startedAt: null,
  finishedAt: null,
};

export function getTodayJakartaDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

let dailyAutoSentDate = getTodayJakartaDateKey();
const dailyAutoSentPhones = new Set<string>();

function ensureDailyAutoSentDateCurrent(): boolean {
  const today = getTodayJakartaDateKey();
  if (dailyAutoSentDate !== today) {
    dailyAutoSentDate = today;
    dailyAutoSentPhones.clear();
    return true;
  }
  return false;
}

export function hasAutoSentToPhoneToday(rawPhone?: string | null): boolean {
  const norm = normalizeWaPhone(rawPhone);
  if (!norm) return false;
  if (ensureDailyAutoSentDateCurrent()) {
    scheduleSaveChatIndex();
  }
  return dailyAutoSentPhones.has(norm);
}

export function markPhoneAutoSentToday(rawPhone?: string | null): boolean {
  const norm = normalizeWaPhone(rawPhone);
  if (!norm) return false;
  ensureDailyAutoSentDateCurrent();
  const alreadyPresent = dailyAutoSentPhones.has(norm);
  dailyAutoSentPhones.add(norm);
  // Flush synchronously right after send so crashes/restarts never allow a duplicate send today
  writeChatIndexToDisk();
  return !alreadyPresent;
}

export function getDailyAutoSentPhonesToday(): string[] {
  if (ensureDailyAutoSentDateCurrent()) {
    scheduleSaveChatIndex();
  }
  return Array.from(dailyAutoSentPhones);
}

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

function isValidChatAnchor(anchor: any): anchor is ChatHistoryAnchor {
  return Boolean(
    anchor &&
      typeof anchor === "object" &&
      anchor.key &&
      typeof anchor.key.remoteJid === "string" &&
      anchor.key.remoteJid.length > 0 &&
      typeof anchor.key.id === "string" &&
      anchor.key.id.length > 0 &&
      typeof anchor.timestampMs === "number" &&
      Number.isFinite(anchor.timestampMs) &&
      anchor.timestampMs > 0
  );
}

function mergeChatIndexSnapshot(parsed: any) {
  if (!parsed || typeof parsed !== "object") return;
  if (Array.isArray(parsed.phones)) {
    for (const p of parsed.phones) {
      const norm = normalizeWaPhone(String(p));
      if (norm.length >= 10) knownChattedPhones.add(norm);
    }
  }
  if (Array.isArray(parsed.sharelocPhones)) {
    for (const p of parsed.sharelocPhones) {
      const norm = normalizeWaPhone(String(p));
      if (norm.length >= 10) {
        knownSharelocPhones.add(norm);
        knownChattedPhones.add(norm);
      }
    }
  }
  if (Array.isArray(parsed.housePhotoPhones)) {
    for (const p of parsed.housePhotoPhones) {
      const norm = normalizeWaPhone(String(p));
      if (norm.length >= 10) {
        knownHousePhotoPhones.add(norm);
        knownChattedPhones.add(norm);
      }
    }
  }
  if (parsed.lidToPhone && typeof parsed.lidToPhone === "object") {
    for (const [lid, pn] of Object.entries(parsed.lidToPhone)) {
      const norm = normalizeWaPhone(String(pn));
      if (lid && norm.length >= 10) {
        lidToPhoneMap.set(lid, norm);
      }
    }
  }
  if (Array.isArray(parsed.pendingLids)) {
    for (const l of parsed.pendingLids) {
      if (typeof l === "string" && l.includes("@lid")) {
        const mapped = lidToPhoneMap.get(l);
        if (mapped) {
          knownChattedPhones.add(mapped);
        } else {
          pendingChattedLids.add(l);
        }
      }
    }
  }
  if (Array.isArray(parsed.pendingSharelocLids)) {
    for (const l of parsed.pendingSharelocLids) {
      if (typeof l === "string" && l.includes("@lid")) {
        const mapped = lidToPhoneMap.get(l);
        if (mapped) {
          knownSharelocPhones.add(mapped);
          knownChattedPhones.add(mapped);
        } else {
          pendingSharelocLids.add(l);
          pendingChattedLids.add(l);
        }
      }
    }
  }
  if (Array.isArray(parsed.pendingHousePhotoLids)) {
    for (const l of parsed.pendingHousePhotoLids) {
      if (typeof l === "string" && l.includes("@lid")) {
        const mapped = lidToPhoneMap.get(l);
        if (mapped) {
          knownHousePhotoPhones.add(mapped);
          knownChattedPhones.add(mapped);
        } else {
          pendingHousePhotoLids.add(l);
          pendingChattedLids.add(l);
        }
      }
    }
  }
  if (parsed.anchorsByPhone && typeof parsed.anchorsByPhone === "object") {
    for (const [phone, anchor] of Object.entries(parsed.anchorsByPhone)) {
      const norm = normalizeWaPhone(phone);
      if (norm.length >= 10 && isValidChatAnchor(anchor)) {
        const existing = oldestChatAnchorByPhone.get(norm);
        if (!existing || anchor.timestampMs < existing.timestampMs) {
          oldestChatAnchorByPhone.set(norm, {
            key: {
              remoteJid: anchor.key.remoteJid,
              fromMe: Boolean(anchor.key.fromMe),
              id: anchor.key.id,
            },
            timestampMs: anchor.timestampMs,
          });
        }
      }
    }
  }
  if (parsed.pendingAnchorsByLid && typeof parsed.pendingAnchorsByLid === "object") {
    for (const [lid, anchor] of Object.entries(parsed.pendingAnchorsByLid)) {
      if (lid.includes("@lid") && isValidChatAnchor(anchor)) {
        const candidate: ChatHistoryAnchor = {
          key: {
            remoteJid: anchor.key.remoteJid,
            fromMe: Boolean(anchor.key.fromMe),
            id: anchor.key.id,
          },
          timestampMs: anchor.timestampMs,
        };
        const mapped = lidToPhoneMap.get(lid);
        if (mapped) {
          const existing = oldestChatAnchorByPhone.get(mapped);
          if (!existing || candidate.timestampMs < existing.timestampMs) {
            oldestChatAnchorByPhone.set(mapped, candidate);
          }
        } else {
          const existing = pendingAnchorsByLid.get(lid);
          if (!existing || candidate.timestampMs < existing.timestampMs) {
            pendingAnchorsByLid.set(lid, candidate);
          }
        }
      }
    }
  }
  if (
    parsed.dailySent &&
    typeof parsed.dailySent === "object" &&
    parsed.dailySent.date === getTodayJakartaDateKey() &&
    Array.isArray(parsed.dailySent.phones)
  ) {
    dailyAutoSentDate = parsed.dailySent.date;
    for (const p of parsed.dailySent.phones) {
      const norm = normalizeWaPhone(String(p));
      if (norm.length >= 10) {
        dailyAutoSentPhones.add(norm);
      }
    }
  }
}

function loadChatIndexFromDisk() {
  for (const filePath of [CHAT_INDEX_BACKUP_FILE, CHAT_INDEX_FILE]) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      mergeChatIndexSnapshot(parsed);
    } catch {
      // Ignore corrupt index or backup file on startup
    }
  }
}

function loadAuthLidMappingsFromDisk() {
  try {
    if (!fs.existsSync(AUTH_DIR)) return;
    const files = fs.readdirSync(AUTH_DIR);
    for (const file of files) {
      const revMatch = file.match(/^lid-mapping-(\d+)_reverse\.json$/);
      if (revMatch) {
        try {
          const pnRaw = JSON.parse(fs.readFileSync(path.join(AUTH_DIR, file), "utf8"));
          if (typeof pnRaw === "string" && /^\d{8,16}$/.test(pnRaw)) {
            recordLidMapping(`${revMatch[1]}@lid`, pnRaw);
          }
        } catch {
          // Ignore malformed mapping file
        }
        continue;
      }
      const fwdMatch = file.match(/^lid-mapping-(\d+)\.json$/);
      if (fwdMatch) {
        try {
          const lidRaw = JSON.parse(fs.readFileSync(path.join(AUTH_DIR, file), "utf8"));
          if (typeof lidRaw === "string" && /^\d{8,20}$/.test(lidRaw)) {
            recordLidMapping(`${lidRaw}@lid`, fwdMatch[1]);
          }
        } catch {
          // Ignore malformed mapping file
        }
      }
    }
  } catch {
    // Ignore disk scan failure
  }
}

function writeJsonAtomicSync(filePath: string, payload: string) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, payload, "utf8");
  fs.renameSync(tmpPath, filePath);
}

enum FirestoreOperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

interface FirestoreErrorInfo {
  error: string;
  operationType: FirestoreOperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
  };
}

let cloudDb: Firestore | null = null;
let cloudLoadAttempted = false;
let cloudSyncInFlight = false;
let cloudSyncQueued = false;
let cloudQuotaCooldownUntil = 0;
let cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;
let lastCloudPhonesSignature = "";
let lastCloudAnchorsSignature = "";
let cloudKnownPhonesFloor = 0;
let cloudKnownSharelocFloor = 0;
let cloudKnownHousePhotoFloor = 0;
let cloudKnownAnchorsFloor = 0;

try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (firebaseConfig?.projectId) {
      const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
      cloudDb =
        firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== "(default)"
          ? getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId)
          : getFirestore(firebaseApp);
    }
  }
} catch {
  cloudDb = null;
}

function logCloudFirestoreError(
  error: unknown,
  operationType: FirestoreOperationType,
  docPath: string | null
) {
  const message = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: message,
    operationType,
    path: docPath,
    authInfo: { userId: null },
  };
  if (message.includes("resource-exhausted") || message.includes("Quota limit exceeded")) {
    cloudQuotaCooldownUntil = Date.now() + 180_000;
  }
  console.warn("[WA Cloud Index] Firestore Error:", JSON.stringify(errInfo));
}

function compressSnapshotToGzipB64(obj: Record<string, any>): string {
  const json = JSON.stringify(obj);
  return zlib.gzipSync(Buffer.from(json, "utf8")).toString("base64");
}

function decompressSnapshotFromGzipB64(b64: string): any | null {
  try {
    const buf = zlib.gunzipSync(Buffer.from(b64, "base64"));
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  }
}

function buildChatIndexSnapshotData() {
  ensureDailyAutoSentDateCurrent();
  if (oldestChatAnchorByPhone.size > MAX_LOCKED_ANCHORS) {
    const kept = Array.from(oldestChatAnchorByPhone.entries()).slice(-MAX_LOCKED_ANCHORS);
    oldestChatAnchorByPhone.clear();
    for (const [k, v] of kept) oldestChatAnchorByPhone.set(k, v);
  }
  if (pendingAnchorsByLid.size > MAX_LOCKED_ANCHORS) {
    const keptPending = Array.from(pendingAnchorsByLid.entries()).slice(-MAX_LOCKED_ANCHORS);
    pendingAnchorsByLid.clear();
    for (const [k, v] of keptPending) pendingAnchorsByLid.set(k, v);
  }
  const anchorsEntries = Array.from(oldestChatAnchorByPhone.entries()).slice(-MAX_LOCKED_ANCHORS);
  const pendingAnchorEntries = Array.from(pendingAnchorsByLid.entries()).slice(-MAX_LOCKED_ANCHORS);
  return {
    phones: Array.from(knownChattedPhones),
    sharelocPhones: Array.from(knownSharelocPhones),
    housePhotoPhones: Array.from(knownHousePhotoPhones),
    lidToPhone: Object.fromEntries(lidToPhoneMap.entries()),
    pendingLids: Array.from(pendingChattedLids).slice(-MAX_LOCKED_ANCHORS),
    pendingSharelocLids: Array.from(pendingSharelocLids).slice(-MAX_LOCKED_ANCHORS),
    pendingHousePhotoLids: Array.from(pendingHousePhotoLids).slice(-MAX_LOCKED_ANCHORS),
    anchorsByPhone: Object.fromEntries(anchorsEntries),
    pendingAnchorsByLid: Object.fromEntries(pendingAnchorEntries),
    anchorLocked: true,
    maxAnchorsLimit: MAX_LOCKED_ANCHORS,
    dailySent: {
      date: dailyAutoSentDate,
      phones: Array.from(dailyAutoSentPhones),
    },
    updatedAt: new Date().toISOString(),
  };
}

function getPhonesShardSignature(data: ReturnType<typeof buildChatIndexSnapshotData>): string {
  return [
    data.phones.length,
    data.sharelocPhones.length,
    data.housePhotoPhones.length,
    Object.keys(data.lidToPhone).length,
    data.pendingLids.length,
    data.pendingSharelocLids.length,
    data.pendingHousePhotoLids.length,
    data.dailySent.date,
    data.dailySent.phones.length,
  ].join(":");
}

function getAnchorsShardSignature(data: ReturnType<typeof buildChatIndexSnapshotData>): string {
  const anchorKeys = Object.keys(data.anchorsByPhone);
  const firstKey = anchorKeys[0] || "";
  const lastKey = anchorKeys[anchorKeys.length - 1] || "";
  return [
    anchorKeys.length,
    Object.keys(data.pendingAnchorsByLid).length,
    firstKey,
    lastKey,
    firstKey ? data.anchorsByPhone[firstKey]?.timestampMs || 0 : 0,
    lastKey ? data.anchorsByPhone[lastKey]?.timestampMs || 0 : 0,
  ].join(":");
}

async function syncChatIndexToCloudNow(): Promise<void> {
  if (!cloudDb || !cloudLoadAttempted) return;
  if (Date.now() < cloudQuotaCooldownUntil) return;
  if (cloudSyncInFlight) {
    cloudSyncQueued = true;
    return;
  }

  cloudSyncInFlight = true;
  try {
    const data = buildChatIndexSnapshotData();
    // Never overwrite cloud with empty/shrunk index if cloud already holds more data
    if (
      data.phones.length < cloudKnownPhonesFloor ||
      data.sharelocPhones.length < cloudKnownSharelocFloor ||
      data.housePhotoPhones.length < cloudKnownHousePhotoFloor
    ) {
      return;
    }

    const phonesSig = getPhonesShardSignature(data);
    const anchorsSig = getAnchorsShardSignature(data);
    const nowIso = data.updatedAt;

    if (phonesSig !== lastCloudPhonesSignature && data.phones.length > 0) {
      const phonesGzipB64 = compressSnapshotToGzipB64({
        phones: data.phones,
        sharelocPhones: data.sharelocPhones,
        housePhotoPhones: data.housePhotoPhones,
        lidToPhone: data.lidToPhone,
        pendingLids: data.pendingLids,
        pendingSharelocLids: data.pendingSharelocLids,
        pendingHousePhotoLids: data.pendingHousePhotoLids,
        dailySent: data.dailySent,
        updatedAt: nowIso,
      });
      if (phonesGzipB64.length <= 950_000) {
        const docPath = "app_data/wa_chat_index_phones";
        try {
          await setDoc(doc(cloudDb, "app_data", "wa_chat_index_phones"), {
            format: "gzip-json-v1",
            payloadGzipB64: phonesGzipB64,
            counts: {
              phones: data.phones.length,
              shareloc: data.sharelocPhones.length,
              housePhoto: data.housePhotoPhones.length,
              lidToPhone: Object.keys(data.lidToPhone).length,
            },
            updatedAt: nowIso,
          });
          lastCloudPhonesSignature = phonesSig;
          cloudKnownPhonesFloor = Math.max(cloudKnownPhonesFloor, data.phones.length);
          cloudKnownSharelocFloor = Math.max(cloudKnownSharelocFloor, data.sharelocPhones.length);
          cloudKnownHousePhotoFloor = Math.max(
            cloudKnownHousePhotoFloor,
            data.housePhotoPhones.length
          );
        } catch (err) {
          logCloudFirestoreError(err, FirestoreOperationType.WRITE, docPath);
        }
      }
    }

    if (
      anchorsSig !== lastCloudAnchorsSignature &&
      (Object.keys(data.anchorsByPhone).length >= cloudKnownAnchorsFloor ||
        Object.keys(data.anchorsByPhone).length > 0)
    ) {
      const anchorsGzipB64 = compressSnapshotToGzipB64({
        anchorsByPhone: data.anchorsByPhone,
        pendingAnchorsByLid: data.pendingAnchorsByLid,
        anchorLocked: true,
        maxAnchorsLimit: MAX_LOCKED_ANCHORS,
        updatedAt: nowIso,
      });
      if (anchorsGzipB64.length <= 950_000) {
        const docPath = "app_data/wa_chat_index_anchors";
        try {
          await setDoc(doc(cloudDb, "app_data", "wa_chat_index_anchors"), {
            format: "gzip-json-v1",
            payloadGzipB64: anchorsGzipB64,
            counts: {
              anchors: Object.keys(data.anchorsByPhone).length,
              pendingAnchors: Object.keys(data.pendingAnchorsByLid).length,
            },
            updatedAt: nowIso,
          });
          lastCloudAnchorsSignature = anchorsSig;
          cloudKnownAnchorsFloor = Math.max(
            cloudKnownAnchorsFloor,
            Object.keys(data.anchorsByPhone).length
          );
        } catch (err) {
          logCloudFirestoreError(err, FirestoreOperationType.WRITE, docPath);
        }
      }
    }
  } finally {
    cloudSyncInFlight = false;
    if (cloudSyncQueued) {
      cloudSyncQueued = false;
      scheduleCloudIndexSync(3000);
    }
  }
}

function scheduleCloudIndexSync(delayMs = 6000) {
  if (!cloudDb || !cloudLoadAttempted) return;
  if (cloudSyncTimer) return;
  cloudSyncTimer = setTimeout(() => {
    cloudSyncTimer = null;
    void syncChatIndexToCloudNow();
  }, delayMs);
}

async function initCloudChatIndexSyncOnBoot(): Promise<void> {
  if (!cloudDb) {
    cloudLoadAttempted = true;
    return;
  }

  let cloudPhonesSig = "";
  let cloudAnchorsSig = "";

  for (const docId of ["wa_chat_index_phones", "wa_chat_index_anchors"]) {
    const docPath = `app_data/${docId}`;
    try {
      let snap;
      try {
        snap = await getDocFromServer(doc(cloudDb, "app_data", docId));
      } catch {
        snap = await getDoc(doc(cloudDb, "app_data", docId));
      }
      if (snap.exists()) {
        const docData = snap.data();
        if (docData?.format === "gzip-json-v1" && typeof docData.payloadGzipB64 === "string") {
          const decoded = decompressSnapshotFromGzipB64(docData.payloadGzipB64);
          if (decoded) {
            if (docId === "wa_chat_index_phones") {
              const cloudPhonesLen = Array.isArray(decoded.phones) ? decoded.phones.length : 0;
              const cloudSharelocLen = Array.isArray(decoded.sharelocPhones)
                ? decoded.sharelocPhones.length
                : 0;
              const cloudPhotoLen = Array.isArray(decoded.housePhotoPhones)
                ? decoded.housePhotoPhones.length
                : 0;
              cloudKnownPhonesFloor = Math.max(cloudKnownPhonesFloor, cloudPhonesLen);
              cloudKnownSharelocFloor = Math.max(cloudKnownSharelocFloor, cloudSharelocLen);
              cloudKnownHousePhotoFloor = Math.max(cloudKnownHousePhotoFloor, cloudPhotoLen);
              cloudPhonesSig = [
                cloudPhonesLen,
                cloudSharelocLen,
                cloudPhotoLen,
                decoded.lidToPhone ? Object.keys(decoded.lidToPhone).length : 0,
                Array.isArray(decoded.pendingLids) ? decoded.pendingLids.length : 0,
                Array.isArray(decoded.pendingSharelocLids) ? decoded.pendingSharelocLids.length : 0,
                Array.isArray(decoded.pendingHousePhotoLids)
                  ? decoded.pendingHousePhotoLids.length
                  : 0,
                decoded.dailySent?.date || "",
                Array.isArray(decoded.dailySent?.phones) ? decoded.dailySent.phones.length : 0,
              ].join(":");
            } else {
              const cloudAnchorsObj =
                decoded.anchorsByPhone && typeof decoded.anchorsByPhone === "object"
                  ? decoded.anchorsByPhone
                  : {};
              const anchorKeys = Object.keys(cloudAnchorsObj);
              const firstKey = anchorKeys[0] || "";
              const lastKey = anchorKeys[anchorKeys.length - 1] || "";
              cloudKnownAnchorsFloor = Math.max(cloudKnownAnchorsFloor, anchorKeys.length);
              cloudAnchorsSig = [
                anchorKeys.length,
                decoded.pendingAnchorsByLid ? Object.keys(decoded.pendingAnchorsByLid).length : 0,
                firstKey,
                lastKey,
                firstKey ? cloudAnchorsObj[firstKey]?.timestampMs || 0 : 0,
                lastKey ? cloudAnchorsObj[lastKey]?.timestampMs || 0 : 0,
              ].join(":");
            }
            mergeChatIndexSnapshot(decoded);
          }
        }
      }
    } catch (err) {
      logCloudFirestoreError(err, FirestoreOperationType.GET, docPath);
    }
  }

  cloudLoadAttempted = true;

  // Persist merged local+cloud superset back to disk without losing anything
  writeChatIndexToDisk(true);

  const mergedSnapshot = buildChatIndexSnapshotData();
  const mergedPhonesSig = getPhonesShardSignature(mergedSnapshot);
  const mergedAnchorsSig = getAnchorsShardSignature(mergedSnapshot);
  lastCloudPhonesSignature = cloudPhonesSig;
  lastCloudAnchorsSignature = cloudAnchorsSig;

  if (
    (mergedSnapshot.phones.length > 0 && mergedPhonesSig !== cloudPhonesSig) ||
    (Object.keys(mergedSnapshot.anchorsByPhone).length > 0 && mergedAnchorsSig !== cloudAnchorsSig)
  ) {
    await syncChatIndexToCloudNow();
  }
}

function writeChatIndexToDisk(skipCloudSchedule = false) {
  if (saveIndexTimer) {
    clearTimeout(saveIndexTimer);
    saveIndexTimer = null;
  }
  try {
    const data = buildChatIndexSnapshotData();
    const serialized = JSON.stringify(data);
    writeJsonAtomicSync(CHAT_INDEX_FILE, serialized);
    writeJsonAtomicSync(CHAT_INDEX_BACKUP_FILE, serialized);
  } catch {
    // Ignore disk write failure
  }
  if (!skipCloudSchedule) {
    scheduleCloudIndexSync(6000);
  }
}

function scheduleSaveChatIndex() {
  if (saveIndexTimer) return;
  saveIndexTimer = setTimeout(() => {
    saveIndexTimer = null;
    writeChatIndexToDisk();
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

function resolveDirectOrMappedPhone(jidRaw?: string | null, altJidRaw?: string | null): string {
  const jid = cleanJidBase(jidRaw);
  const altJid = cleanJidBase(altJidRaw);
  const direct = extractPhoneFromStandardJid(jid) || extractPhoneFromStandardJid(altJid);
  if (direct) return direct;
  if (jid.endsWith("@lid")) {
    return lidToPhoneMap.get(jid) || "";
  }
  return "";
}

function unwrapWaMessageContent(message: any): any {
  let curr = message;
  for (let depth = 0; depth < 6 && curr && typeof curr === "object"; depth++) {
    if (curr.ephemeralMessage?.message) {
      curr = curr.ephemeralMessage.message;
      continue;
    }
    if (curr.viewOnceMessage?.message) {
      curr = curr.viewOnceMessage.message;
      continue;
    }
    if (curr.viewOnceMessageV2?.message) {
      curr = curr.viewOnceMessageV2.message;
      continue;
    }
    if (curr.viewOnceMessageV2Extension?.message) {
      curr = curr.viewOnceMessageV2Extension.message;
      continue;
    }
    if (curr.documentWithCaptionMessage?.message) {
      curr = curr.documentWithCaptionMessage.message;
      continue;
    }
    if (curr.editedMessage?.message) {
      curr = curr.editedMessage.message;
      continue;
    }
    break;
  }
  return curr;
}

function isCustomerSharelocMessage(msg: any): boolean {
  if (!msg) return false;
  const inner = unwrapWaMessageContent(msg.message);
  if (!inner || typeof inner !== "object") return false;

  if (inner.locationMessage || inner.liveLocationMessage) {
    return true;
  }

  const textBody = [
    inner.conversation,
    inner.extendedTextMessage?.text,
    inner.extendedTextMessage?.canonicalUrl,
    inner.extendedTextMessage?.matchedText,
    inner.imageMessage?.caption,
    inner.videoMessage?.caption,
    inner.documentMessage?.caption,
  ]
    .filter((v) => typeof v === "string" && v.trim())
    .join(" ");

  if (!textBody) return false;

  if (
    /(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.com|google\.com\/maps|maps\.apple\.com|waze\.com\/ul|openstreetmap\.org)/i.test(
      textBody
    )
  ) {
    return true;
  }

  if (/\b-?\d{1,2}\.\d{5,}\s*,\s*-?\d{1,3}\.\d{5,}\b/.test(textBody)) {
    return true;
  }

  return false;
}

function isCustomerHousePhotoMessage(msg: any): boolean {
  if (!msg) return false;
  const inner = unwrapWaMessageContent(msg.message);
  if (!inner || typeof inner !== "object") return false;

  const docMime =
    typeof inner.documentMessage?.mimetype === "string"
      ? inner.documentMessage.mimetype.toLowerCase()
      : "";
  const docName =
    typeof inner.documentMessage?.fileName === "string"
      ? inner.documentMessage.fileName.toLowerCase()
      : "";
  const isImageDoc =
    docMime.startsWith("image/") ||
    /\.(?:jpe?g|png|webp|heic|bmp)$/i.test(docName);

  const isImage = Boolean(
    inner.imageMessage || inner.albumMessage || isImageDoc
  );
  if (!isImage) return false;

  // Exclude automated Hold/Return failure notices sent by the courier
  if (msg?.key?.fromMe) {
    const caption = String(
      inner.imageMessage?.caption || inner.documentMessage?.caption || ""
    );
    if (
      caption &&
      /(?:belum\s+dapat\s+(?:kami\s+)?antar|kendala\s+pengantaran|di-?\s*hold|gagal\s+kirim|bawa\s+kembali|\bretur\b)/i.test(
        caption
      )
    ) {
      return false;
    }
  }

  // Photos sent by either customer OR user/courier count as existing house/delivery photo
  return true;
}

export function classifyWaHistoryMessage(msg: any): {
  hasShareloc: boolean;
  hasHousePhoto: boolean;
} {
  return {
    hasShareloc: isCustomerSharelocMessage(msg),
    hasHousePhoto: isCustomerHousePhotoMessage(msg),
  };
}

function extractMessageTimestampMs(msg: any): number {
  const raw = msg?.messageTimestamp;
  if (!raw) return 0;
  let num = 0;
  if (typeof raw === "number") {
    num = raw;
  } else if (typeof raw === "string") {
    num = Number(raw) || 0;
  } else if (typeof raw?.toNumber === "function") {
    num = raw.toNumber();
  } else if (typeof raw?.low === "number") {
    num = raw.low;
  }
  if (!num || !Number.isFinite(num)) return 0;
  return num < 1e12 ? num * 1000 : num;
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
  if (pendingSharelocLids.has(lid)) {
    pendingSharelocLids.delete(lid);
    if (!knownSharelocPhones.has(normPn)) {
      knownSharelocPhones.add(normPn);
    }
    if (!knownChattedPhones.has(normPn)) {
      knownChattedPhones.add(normPn);
    }
    changed = true;
  }
  if (pendingHousePhotoLids.has(lid)) {
    pendingHousePhotoLids.delete(lid);
    if (!knownHousePhotoPhones.has(normPn)) {
      knownHousePhotoPhones.add(normPn);
    }
    if (!knownChattedPhones.has(normPn)) {
      knownChattedPhones.add(normPn);
    }
    changed = true;
  }
  const pendingAnchor = pendingAnchorsByLid.get(lid);
  if (pendingAnchor) {
    pendingAnchorsByLid.delete(lid);
    const existing = oldestChatAnchorByPhone.get(normPn);
    if (!existing || pendingAnchor.timestampMs < existing.timestampMs) {
      oldestChatAnchorByPhone.set(normPn, pendingAnchor);
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

function inspectChatHistoryMessage(msg: any) {
  if (!msg?.key) return;
  const jid = cleanJidBase(msg.key.remoteJid);
  const altJid = cleanJidBase(msg.key.remoteJidAlt);

  if (
    !jid ||
    jid.endsWith("@g.us") ||
    jid === "status@broadcast" ||
    jid.endsWith("@newsletter") ||
    jid.endsWith("@broadcast")
  ) {
    return;
  }

  recordChattedJid(jid, altJid);

  const resolvedPhone = resolveDirectOrMappedPhone(jid, altJid);
  if (connectedUser?.phone && resolvedPhone === connectedUser.phone) {
    return;
  }

  // Track oldest message anchor per phone (or pending LID) for on-demand deep history verification
  const tsMs = extractMessageTimestampMs(msg);
  if (msg.key.id && tsMs > 0) {
    const candidateAnchor: ChatHistoryAnchor = {
      key: {
        remoteJid: msg.key.remoteJid,
        fromMe: Boolean(msg.key.fromMe),
        id: msg.key.id,
      },
      timestampMs: tsMs,
    };
    if (resolvedPhone) {
      const existing = oldestChatAnchorByPhone.get(resolvedPhone);
      if (!existing || tsMs < existing.timestampMs) {
        oldestChatAnchorByPhone.set(resolvedPhone, candidateAnchor);
        scheduleSaveChatIndex();
      }
    } else if (jid.endsWith("@lid")) {
      const existing = pendingAnchorsByLid.get(jid);
      if (!existing || tsMs < existing.timestampMs) {
        pendingAnchorsByLid.set(jid, candidateAnchor);
        scheduleSaveChatIndex();
      }
    }
  }

  if (isCustomerSharelocMessage(msg)) {
    let changed = false;
    if (resolvedPhone) {
      if (!knownSharelocPhones.has(resolvedPhone)) {
        knownSharelocPhones.add(resolvedPhone);
        changed = true;
      }
      if (!knownChattedPhones.has(resolvedPhone)) {
        knownChattedPhones.add(resolvedPhone);
        changed = true;
      }
    } else if (jid.endsWith("@lid") && !pendingSharelocLids.has(jid)) {
      pendingSharelocLids.add(jid);
      pendingChattedLids.add(jid);
      changed = true;
    }
    if (changed) scheduleSaveChatIndex();
  }

  if (isCustomerHousePhotoMessage(msg)) {
    let changed = false;
    if (resolvedPhone) {
      if (!knownHousePhotoPhones.has(resolvedPhone)) {
        knownHousePhotoPhones.add(resolvedPhone);
        changed = true;
      }
      if (!knownChattedPhones.has(resolvedPhone)) {
        knownChattedPhones.add(resolvedPhone);
        changed = true;
      }
    } else if (jid.endsWith("@lid") && !pendingHousePhotoLids.has(jid)) {
      pendingHousePhotoLids.add(jid);
      pendingChattedLids.add(jid);
      changed = true;
    }
    if (changed) scheduleSaveChatIndex();
  }
}

loadChatIndexFromDisk();
loadAuthLidMappingsFromDisk();

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
    knownSharelocCount: knownSharelocPhones.size,
    knownHousePhotoCount: knownHousePhotoPhones.size,
    lockedAnchorsCount: Math.min(oldestChatAnchorByPhone.size, MAX_LOCKED_ANCHORS),
    maxAnchorsLimit: MAX_LOCKED_ANCHORS,
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
      shouldSyncHistoryMessage: () => true,
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
        loadAuthLidMappingsFromDisk();
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
          // Lock & flush all captured anchors and chat history locally + to Firestore before clearing auth folder
          writeChatIndexToDisk(true);
          void syncChatIndexToCloudNow();
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
          writeChatIndexToDisk(true);
          void syncChatIndexToCloudNow();
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

    const notifyHistorySyncListeners = () => {
      for (const listener of Array.from(historySyncListeners)) {
        try {
          listener();
        } catch {
          // Ignore listener cleanup errors
        }
      }
    };

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
          const chatLid = (chat as any)?.lidJid || (chat?.id?.endsWith("@lid") ? chat.id : undefined);
          const chatPn = (chat as any)?.pnJid || (chat?.id?.endsWith("@s.whatsapp.net") ? chat.id : undefined);
          if (chatLid && chatPn) {
            recordLidMapping(chatLid, chatPn);
          }
          if (chat?.id) {
            recordChattedJid(chat.id, chatPn);
          }
          if (Array.isArray((chat as any)?.messages)) {
            for (const entry of (chat as any).messages) {
              const msgObj = entry?.message || entry;
              inspectChatHistoryMessage(msgObj);
            }
          }
        }
      }
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          inspectChatHistoryMessage(msg);
        }
      }
      // Lock newly synced anchors & history to disk immediately per chunk
      if (saveIndexTimer) {
        writeChatIndexToDisk();
      }
      notifyHistorySyncListeners();
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
        const chatLid = (chat as any)?.lidJid || (chat?.id?.endsWith("@lid") ? chat.id : undefined);
        const chatPn = (chat as any)?.pnJid || (chat?.id?.endsWith("@s.whatsapp.net") ? chat.id : undefined);
        if (chatLid && chatPn) {
          recordLidMapping(chatLid, chatPn);
        }
        if (chat?.id) recordChattedJid(chat.id, chatPn);
        if (Array.isArray((chat as any)?.messages)) {
          for (const entry of (chat as any).messages) {
            const msgObj = entry?.message || entry;
            inspectChatHistoryMessage(msgObj);
          }
        }
      }
    });

    socket.ev.on("chats.update", (chats) => {
      for (const chat of chats) {
        const chatLid = (chat as any)?.lidJid || (chat?.id?.endsWith("@lid") ? chat.id : undefined);
        const chatPn = (chat as any)?.pnJid || (chat?.id?.endsWith("@s.whatsapp.net") ? chat.id : undefined);
        if (chatLid && chatPn) {
          recordLidMapping(chatLid, chatPn);
        }
        if (chat?.id) recordChattedJid(chat.id, chatPn);
        if (Array.isArray((chat as any)?.messages)) {
          for (const entry of (chat as any).messages) {
            const msgObj = entry?.message || entry;
            inspectChatHistoryMessage(msgObj);
          }
        }
      }
    });

    socket.ev.on("messages.upsert", ({ messages }) => {
      if (!Array.isArray(messages)) return;
      for (const msg of messages) {
        inspectChatHistoryMessage(msg);
      }
      notifyHistorySyncListeners();
    });

    socket.ev.on("messages.update", (updates) => {
      if (!Array.isArray(updates)) return;
      for (const u of updates) {
        if (u?.key && u?.update?.message) {
          inspectChatHistoryMessage({
            key: u.key,
            message: u.update.message,
            messageTimestamp: (u.update as any).messageTimestamp,
          });
        }
      }
      notifyHistorySyncListeners();
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
  stopPrecheckCustomers();
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
  // Lock anchors, pending LID anchors, chat history index, and daily send protection across logout/re-pairing
  deepHistoryCheckedAt.clear();
  onWhatsAppLidCheckedAt.clear();
  historySyncListeners.clear();
  writeChatIndexToDisk(true);
  void syncChatIndexToCloudNow();

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
  void initCloudChatIndexSyncOnBoot();
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
    status === "skipped_manual" ||
    status === "skipped_daily_limit" ||
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
  activeQueueItemsRef = null;
  if (autoSendState.running) {
    autoSendState.running = false;
    autoSendState.phase = "paused";
    autoSendState.isInitialDelay = false;
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
  activeQueueItemsRef = null;
  pausedJobContext = null;
  if (autoSendState.running || autoSendState.phase === "paused") {
    autoSendState.running = false;
    autoSendState.phase = "stopped";
    autoSendState.isInitialDelay = false;
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
  activeQueueItemsRef = null;
  pausedJobContext = null;
  autoSendState = {
    running: false,
    phase: "idle",
    isInitialDelay: false,
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

async function ensureDeepCustomerHistoryChecked(
  normPhone: string,
  requireBoth = false
): Promise<void> {
  if (!sock || connectionStatus !== "connected") return;
  const hasSharelocNow = knownSharelocPhones.has(normPhone);
  const hasHousePhotoNow = knownHousePhotoPhones.has(normPhone);
  if (requireBoth ? hasSharelocNow && hasHousePhotoNow : hasSharelocNow || hasHousePhotoNow) return;

  const now = Date.now();
  const lastDeepCheck = deepHistoryCheckedAt.get(normPhone) || 0;
  if (now - lastDeepCheck < DEEP_HISTORY_COOLDOWN_MS) return;

  const anchor = oldestChatAnchorByPhone.get(normPhone);
  deepHistoryCheckedAt.set(normPhone, now);
  if (!anchor?.key?.id || !anchor.timestampMs) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const isSatisfied = () =>
      requireBoth
        ? knownSharelocPhones.has(normPhone) && knownHousePhotoPhones.has(normPhone)
        : knownSharelocPhones.has(normPhone) || knownHousePhotoPhones.has(normPhone);

    const done = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      historySyncListeners.delete(onHistoryUpdate);
      resolve();
    };

    const onHistoryUpdate = () => {
      if (isSatisfied()) {
        done();
      }
    };

    historySyncListeners.add(onHistoryUpdate);
    timer = setTimeout(done, 1600);

    void (async () => {
      try {
        if (typeof sock?.fetchMessageHistory === "function") {
          await sock.fetchMessageHistory(50, anchor.key, anchor.timestampMs);
          setTimeout(() => {
            if (!settled && isSatisfied()) {
              done();
            }
          }, 300);
        } else {
          done();
        }
      } catch {
        done();
      }
    })();
  });
}

async function resolveLidForPhoneFast(normPhone: string): Promise<void> {
  if (!sock || connectionStatus !== "connected") return;
  const now = Date.now();

  try {
    const lidMappingStore = (sock as any)?.signalRepository?.lidMapping;
    if (typeof lidMappingStore?.getLIDForPN === "function") {
      const resolved = await Promise.race([
        lidMappingStore.getLIDForPN(`${normPhone}@s.whatsapp.net`),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 700)),
      ]);
      const cleanLid = cleanJidBase(typeof resolved === "string" ? resolved : null);
      if (cleanLid && cleanLid.endsWith("@lid")) {
        recordLidMapping(cleanLid, normPhone);
      }
    }
  } catch {
    // Ignore transient lidMapping store lookup failure
  }

  const lastLidCheck = onWhatsAppLidCheckedAt.get(normPhone) || 0;
  if (
    (!knownSharelocPhones.has(normPhone) || !knownHousePhotoPhones.has(normPhone)) &&
    now - lastLidCheck > 60_000
  ) {
    onWhatsAppLidCheckedAt.set(normPhone, now);
    try {
      const waCheck = await Promise.race([
        sock.onWhatsApp(`${normPhone}@s.whatsapp.net`),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 700)),
      ]);
      const firstCheck = waCheck?.[0];
      const resolvedLid = cleanJidBase((firstCheck as any)?.lid);
      if (resolvedLid && resolvedLid.endsWith("@lid")) {
        recordLidMapping(resolvedLid, normPhone);
      }
    } catch {
      // Ignore transient lookup failures
    }
  }
}

export interface CustomerChatCheckResult {
  phone: string;
  hasPriorChat: boolean;
  hasShareloc: boolean;
  hasHousePhoto: boolean;
  hasAllLocationProof: boolean;
  deepChecked: boolean;
  gatewayConnected: boolean;
  checkedAt: number;
}

export async function checkCustomerChatRequirements(
  rawPhone: string,
  options?: { deepCheck?: boolean }
): Promise<CustomerChatCheckResult> {
  const normPhone = normalizeWaPhone(rawPhone);
  const gatewayConnected = connectionStatus === "connected" && Boolean(sock);
  if (!isValidServerWaPhone(normPhone)) {
    return {
      phone: normPhone,
      hasPriorChat: false,
      hasShareloc: false,
      hasHousePhoto: false,
      hasAllLocationProof: false,
      deepChecked: false,
      gatewayConnected,
      checkedAt: Date.now(),
    };
  }

  if (
    gatewayConnected &&
    sock &&
    (!knownSharelocPhones.has(normPhone) || !knownHousePhotoPhones.has(normPhone))
  ) {
    await resolveLidForPhoneFast(normPhone);
  }

  let hasPriorChat = knownChattedPhones.has(normPhone);
  let hasShareloc = knownSharelocPhones.has(normPhone);
  let hasHousePhoto = knownHousePhotoPhones.has(normPhone);

  if (
    options?.deepCheck !== false &&
    gatewayConnected &&
    (!hasShareloc || !hasHousePhoto) &&
    oldestChatAnchorByPhone.has(normPhone)
  ) {
    await ensureDeepCustomerHistoryChecked(normPhone, true);
    hasPriorChat = knownChattedPhones.has(normPhone);
    hasShareloc = knownSharelocPhones.has(normPhone);
    hasHousePhoto = knownHousePhotoPhones.has(normPhone);
  } else if (options?.deepCheck !== false && gatewayConnected) {
    deepHistoryCheckedAt.set(normPhone, Date.now());
  }

  return {
    phone: normPhone,
    hasPriorChat,
    hasShareloc,
    hasHousePhoto,
    hasAllLocationProof: hasShareloc || hasHousePhoto,
    deepChecked: deepHistoryCheckedAt.has(normPhone),
    gatewayConnected,
    checkedAt: Date.now(),
  };
}

export function checkBatchCustomerChatRequirements(
  rawPhones: string[]
): Record<string, CustomerChatCheckResult> {
  const gatewayConnected = connectionStatus === "connected" && Boolean(sock);
  const now = Date.now();
  const results: Record<string, CustomerChatCheckResult> = {};

  for (const raw of rawPhones) {
    const normPhone = normalizeWaPhone(raw);
    if (!normPhone || !isValidServerWaPhone(normPhone)) continue;
    const hasPriorChat = knownChattedPhones.has(normPhone);
    const hasShareloc = knownSharelocPhones.has(normPhone);
    const hasHousePhoto = knownHousePhotoPhones.has(normPhone);
    results[normPhone] = {
      phone: normPhone,
      hasPriorChat,
      hasShareloc,
      hasHousePhoto,
      hasAllLocationProof: hasShareloc || hasHousePhoto,
      deepChecked: deepHistoryCheckedAt.has(normPhone),
      gatewayConnected,
      checkedAt: now,
    };
  }

  return results;
}

export function getPrecheckState(): WaPrecheckStateSnapshot {
  return {
    ...precheckState,
    checkedPhones: [...precheckState.checkedPhones],
  };
}

export function stopPrecheckCustomers(): WaPrecheckStateSnapshot {
  precheckToken++;
  if (precheckState.running) {
    precheckState = {
      ...precheckState,
      running: false,
      currentCustomerId: null,
      currentCustomerName: null,
      currentCustomerPhone: null,
      finishedAt: Date.now(),
    };
  }
  return getPrecheckState();
}

export function startPrecheckCustomers(
  rawItems: Array<{ id?: string; name?: string; phone: string }>
): { precheck: WaPrecheckStateSnapshot; results: Record<string, CustomerChatCheckResult> } {
  const uniquePhoneItems: Array<{ id: string; name: string; phone: string }> = [];
  const seenPhones = new Set<string>();

  for (const item of rawItems) {
    const normPhone = normalizeWaPhone(item?.phone);
    if (!isValidServerWaPhone(normPhone) || seenPhones.has(normPhone)) continue;
    seenPhones.add(normPhone);
    uniquePhoneItems.push({
      id: typeof item?.id === "string" ? item.id : normPhone,
      name: typeof item?.name === "string" && item.name.trim() ? item.name.trim() : "Pelanggan",
      phone: normPhone,
    });
  }

  const instantResults = checkBatchCustomerChatRequirements(
    uniquePhoneItems.map((it) => it.phone)
  );

  // Strictly read-only background scan; never interrupts an active auto-send queue
  if (
    uniquePhoneItems.length === 0 ||
    connectionStatus !== "connected" ||
    !sock ||
    autoSendState.running
  ) {
    return {
      precheck: getPrecheckState(),
      results: instantResults,
    };
  }

  const token = ++precheckToken;
  precheckState = {
    running: true,
    total: uniquePhoneItems.length,
    completed: 0,
    currentCustomerId: uniquePhoneItems[0]?.id || null,
    currentCustomerName: uniquePhoneItems[0]?.name || null,
    currentCustomerPhone: uniquePhoneItems[0]?.phone || null,
    checkedPhones: [],
    startedAt: Date.now(),
    finishedAt: null,
  };

  void (async () => {
    for (let i = 0; i < uniquePhoneItems.length; i++) {
      if (
        token !== precheckToken ||
        autoSendState.running ||
        connectionStatus !== "connected" ||
        !sock
      ) {
        break;
      }
      const entry = uniquePhoneItems[i];
      precheckState.currentCustomerId = entry.id;
      precheckState.currentCustomerName = entry.name;
      precheckState.currentCustomerPhone = entry.phone;

      try {
        await checkCustomerChatRequirements(entry.phone, { deepCheck: true });
      } catch {
        // Ignore transient per-customer read errors
      }

      if (token !== precheckToken || autoSendState.running) {
        break;
      }
      if (!precheckState.checkedPhones.includes(entry.phone)) {
        precheckState.checkedPhones.push(entry.phone);
      }
      precheckState.completed = i + 1;
      await new Promise((r) => setTimeout(r, 120));
    }

    if (token === precheckToken) {
      precheckState = {
        ...precheckState,
        running: false,
        currentCustomerId: null,
        currentCustomerName: null,
        currentCustomerPhone: null,
        finishedAt: Date.now(),
      };
    }
  })();

  return {
    precheck: getPrecheckState(),
    results: instantResults,
  };
}

function buildAutoMessagesForItem(
  item: AutoSendInputItem,
  hasPriorChat: boolean,
  hasSentShareloc: boolean,
  hasHousePhoto: boolean,
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
  // Once Shareloc OR House Photo (or both) exist in chat, never request shareloc again
  const hasSufficientLocationProof = hasSentShareloc || hasHousePhoto;

  // Rule 1: Shareloc and/or House Photo present & Non-COD -> skip automatically (send nothing, mark Terkirim)
  if (hasSufficientLocationProof && codAmount === 0) {
    return { action: "skip", text: "" };
  }

  // Rule 2: Shareloc and/or House Photo present & COD -> send ONLY COD nominal template (no shareloc request)
  if (hasSufficientLocationProof && codAmount > 0) {
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

  // Rule 3: Neither Shareloc nor House Photo present -> send full template (need shareloc / delivery info)
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
  initialHasSentAnyMessage: boolean,
  initialDelayMs = 0
) {
  void (async () => {
    let hasSentAnyMessage = initialHasSentAnyMessage;

    if (initialDelayMs > 0 && !initialHasSentAnyMessage) {
      if (!sock || connectionStatus !== "connected") {
        pauseAutoSendQueue("Koneksi WhatsApp terputus sebelum kirim otomatis dimulai.");
        return;
      }

      const waitEndAt = Date.now() + initialDelayMs;
      autoSendState.phase = "waiting_delay";
      autoSendState.isInitialDelay = true;
      autoSendState.nextSendAt = waitEndAt;
      autoSendState.delaySeconds = Math.max(1, Math.round(initialDelayMs / 1000));
      autoSendState.currentCustomerId = queueItems[0]?.id || null;
      autoSendState.currentCustomerName = queueItems[0]?.name || "Pelanggan";

      // Run read-only chat history scan during initial wait so Shareloc/Foto Rumah badges update live
      void (async () => {
        for (let preIdx = 0; preIdx < queueItems.length; preIdx++) {
          if (token !== activeJobToken || !autoSendState.running) break;
          if (Date.now() >= waitEndAt - 1500) break;
          const preItem = queueItems[preIdx];
          if (!preItem || preItem.manualSkipAutoSend) continue;
          const rawPh = preItem.cleanPhone || preItem.phone || "";
          const normPh = normalizeWaPhone(rawPh);
          if (!isValidServerWaPhone(normPh)) continue;
          try {
            await checkCustomerChatRequirements(normPh, { deepCheck: true });
          } catch {
            // Ignore transient precheck errors during initial wait
          }
          await new Promise((r) => setTimeout(r, 120));
        }
      })();

      const shouldProceed = await waitInterruptible(initialDelayMs, token);
      autoSendState.isInitialDelay = false;
      if (!shouldProceed) {
        return;
      }
      autoSendState.nextSendAt = null;
      autoSendState.delaySeconds = null;
    }

    for (let i = 0; i < queueItems.length; i++) {
      const item = queueItems[i];
      const itemIndex = sequenceOffset + i;
      if (token !== activeJobToken || !autoSendState.running) break;

      if (!sock || connectionStatus !== "connected") {
        pauseAutoSendQueue("Koneksi WhatsApp terputus. Tekan Lanjutkan Send setelah terhubung.");
        break;
      }

      if (item.manualSkipAutoSend) {
        autoSendState.items[item.id] = {
          customerId: item.id,
          name: item.name || "Pelanggan",
          phone: item.phone || "",
          status: "skipped_manual",
          reason: "Di-skip manual oleh user — dilewati otomatis",
        };
        autoSendState.skippedCount++;
        autoSendState.processed++;
        continue;
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

      if (hasAutoSentToPhoneToday(normPhone)) {
        autoSendState.items[item.id] = {
          customerId: item.id,
          name: item.name || "Pelanggan",
          phone: item.phone || "",
          status: "skipped_daily_limit",
          hasPriorChat: true,
          hasSentShareloc: knownSharelocPhones.has(normPhone),
          hasHousePhoto: knownHousePhotoPhones.has(normPhone),
          reason: "Maksimal 1x kirim otomatis per hari ke nomor tujuan yang sama",
        };
        autoSendState.skippedCount++;
        autoSendState.processed++;
        continue;
      }

      // Check known prior chat, shareloc & house photo status
      let hasPriorChat =
        knownChattedPhones.has(normPhone) || Boolean(item.waTemplateSent);
      let hasSentShareloc = knownSharelocPhones.has(normPhone);
      let hasHousePhoto = knownHousePhotoPhones.has(normPhone);

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
            if (pendingSharelocLids.has(resolvedLid)) {
              hasPriorChat = true;
              hasSentShareloc = true;
            }
            if (pendingHousePhotoLids.has(resolvedLid)) {
              hasPriorChat = true;
              hasHousePhoto = true;
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

      if (!hasSentShareloc && !hasHousePhoto) {
        await ensureDeepCustomerHistoryChecked(normPhone, false);
        hasSentShareloc = knownSharelocPhones.has(normPhone);
        hasHousePhoto = knownHousePhotoPhones.has(normPhone);
        if (hasSentShareloc || hasHousePhoto) {
          hasPriorChat = true;
        }
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

      const activeTemplates = pausedJobContext?.templates || templates;
      const activeLocs = pausedJobContext?.tempatCodList || tempatCodList;
      const plan = buildAutoMessagesForItem(
        item,
        hasPriorChat,
        hasSentShareloc,
        hasHousePhoto,
        activeTemplates,
        activeLocs,
        itemIndex
      );

      if (plan.action === "skip") {
        autoSendState.items[item.id] = {
          customerId: item.id,
          name: item.name || "Pelanggan",
          phone: item.phone || "",
          status: "skipped_chatted",
          hasPriorChat,
          hasSentShareloc,
          hasHousePhoto,
          reason:
            hasSentShareloc && hasHousePhoto
              ? "Shareloc & Foto Rumah sudah ada (Non-COD) — tanpa kirim pesan"
              : hasSentShareloc
              ? "Sudah ada Shareloc di chat (Non-COD) — tanpa kirim pesan"
              : "Sudah ada Foto Rumah di chat (Non-COD) — tanpa kirim pesan",
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
            hasPriorChat,
            hasSentShareloc,
            hasHousePhoto,
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

      // Re-check daily limit right before socket write in case of pause/resume edge timing
      if (hasAutoSentToPhoneToday(normPhone)) {
        autoSendState.items[item.id] = {
          customerId: item.id,
          name: item.name || "Pelanggan",
          phone: item.phone || "",
          status: "skipped_daily_limit",
          hasPriorChat: true,
          hasSentShareloc,
          hasHousePhoto,
          reason: "Maksimal 1x kirim otomatis per hari ke nomor tujuan yang sama",
        };
        autoSendState.skippedCount++;
        autoSendState.processed++;
        continue;
      }

      autoSendState.phase = "sending";
      autoSendState.nextSendAt = null;
      autoSendState.delaySeconds = null;
      autoSendState.items[item.id] = {
        customerId: item.id,
        name: item.name || "Pelanggan",
        phone: item.phone || "",
        status: "sending",
        hasPriorChat,
        hasSentShareloc,
        hasHousePhoto,
        reason: "Mengirim pesan...",
      };

      try {
        await sock.sendMessage(targetJid, { text: plan.text });
        hasSentAnyMessage = true;
        lastActualSentAt = Date.now();
        markPhoneAutoSentToday(normPhone);

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
          hasPriorChat,
          hasSentShareloc,
          hasHousePhoto,
          sentAt: Date.now(),
          reason:
            plan.action === "send_cod_only"
              ? hasSentShareloc && hasHousePhoto
                ? "Shareloc & Foto Rumah sudah ada — terkirim info COD saja"
                : hasSentShareloc
                ? "Sudah ada Shareloc di chat — terkirim info COD saja"
                : "Sudah ada Foto Rumah di chat — terkirim info COD saja"
              : hasPriorChat
              ? "Belum ada Shareloc/Foto di chat — terkirim template lengkap"
              : "Belum pernah chat — terkirim template lengkap",
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
          hasPriorChat,
          hasSentShareloc,
          hasHousePhoto,
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
      activeQueueItemsRef = null;
      autoSendState.running = false;
      autoSendState.phase = "completed";
      autoSendState.isInitialDelay = false;
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
        activeQueueItemsRef = null;
        autoSendState.phase = "completed";
        autoSendState.isInitialDelay = false;
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
  tempatCodList: TempatCodItem[],
  options?: { initialDelayMs?: number }
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

  // Yield any ongoing background precheck cleanly so user can start auto-send immediately
  stopPrecheckCustomers();

  const initialDelayMs = Math.max(0, Math.min(300_000, Number(options?.initialDelayMs) || 0));
  const queueCopy = [...items];
  const token = ++activeJobToken;
  activeQueueItemsRef = queueCopy;
  pausedJobContext = { items: [...queueCopy], templates, tempatCodList };

  const initialMap: Record<string, AutoSendItemResult> = {};
  for (const item of queueCopy) {
    initialMap[item.id] = {
      customerId: item.id,
      name: item.name || "Pelanggan",
      phone: item.phone || "",
      status: "pending",
    };
  }

  autoSendState = {
    running: true,
    phase: initialDelayMs > 0 ? "waiting_delay" : "checking",
    isInitialDelay: initialDelayMs > 0,
    total: queueCopy.length,
    processed: 0,
    sentFullCount: 0,
    sentCodOnlyCount: 0,
    skippedCount: 0,
    failedCount: 0,
    currentCustomerId: queueCopy[0]?.id || null,
    currentCustomerName: queueCopy[0]?.name || null,
    nextSendAt: initialDelayMs > 0 ? Date.now() + initialDelayMs : null,
    delaySeconds: initialDelayMs > 0 ? Math.max(1, Math.round(initialDelayMs / 1000)) : null,
    startedAt: Date.now(),
    finishedAt: null,
    lastError: null,
    items: initialMap,
  };

  runAutoSendWorker(queueCopy, templates, tempatCodList, token, 0, false, initialDelayMs);

  return getAutoSendState();
}

export function enqueueAutoSendBatch(
  items: AutoSendInputItem[],
  templates: AutoSendTemplates,
  tempatCodList: TempatCodItem[],
  options?: { initialDelayMs?: number }
): AutoSendStateSnapshot {
  if (connectionStatus !== "connected" || !sock) {
    throw new Error("WhatsApp belum terhubung. Hubungkan WhatsApp terlebih dahulu.");
  }
  if (!Array.isArray(items) || items.length === 0) {
    return getAutoSendState();
  }

  if (autoSendState.running && activeQueueItemsRef) {
    const newItems = items.filter((it) => !autoSendState.items[it.id]);
    if (newItems.length > 0) {
      for (const item of newItems) {
        autoSendState.items[item.id] = {
          customerId: item.id,
          name: item.name || "Pelanggan",
          phone: item.phone || "",
          status: "pending",
        };
      }
      autoSendState.total += newItems.length;
      activeQueueItemsRef.push(...newItems);
      if (pausedJobContext) {
        pausedJobContext.items = [...pausedJobContext.items, ...newItems];
        pausedJobContext.templates = templates;
        pausedJobContext.tempatCodList = tempatCodList;
      }
    }
    return getAutoSendState();
  }

  if (autoSendState.phase === "paused" && pausedJobContext) {
    const newItems = items.filter((it) => !autoSendState.items[it.id]);
    if (newItems.length > 0) {
      for (const item of newItems) {
        autoSendState.items[item.id] = {
          customerId: item.id,
          name: item.name || "Pelanggan",
          phone: item.phone || "",
          status: "pending",
        };
      }
      autoSendState.total += newItems.length;
      pausedJobContext.items = [...pausedJobContext.items, ...newItems];
      pausedJobContext.templates = templates;
      pausedJobContext.tempatCodList = tempatCodList;
    }
    return getAutoSendState();
  }

  return startAutoSendQueue(items, templates, tempatCodList, options);
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

  stopPrecheckCustomers();

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
    if (
      existing &&
      isTerminalAutoSendStatus(existing.status) &&
      !(existing.status === "skipped_manual" && !item.manualSkipAutoSend)
    ) {
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
    } else if (
      res.status === "skipped_chatted" ||
      res.status === "skipped_manual" ||
      res.status === "skipped_daily_limit"
    ) {
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
  activeQueueItemsRef = remainingQueue;
  autoSendState = {
    ...autoSendState,
    running: true,
    phase: "checking",
    isInitialDelay: false,
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
    hadPriorSent,
    0
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

const inviteTitleCache = new Map<string, { subject: string; fetchedAt: number }>();

function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;|&#47;/gi, "/")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

async function fetchAllowlistedGroupInviteTitle(inviteCode: string): Promise<string | null> {
  if (!ALLOWED_HOLD_GROUP_CODES.has(inviteCode)) return null;
  const now = Date.now();
  const cached = inviteTitleCache.get(inviteCode);
  if (cached && now - cached.fetchedAt <= GROUP_CACHE_TTL_MS) {
    return cached.subject;
  }

  try {
    const res = await fetch(`https://chat.whatsapp.com/${encodeURIComponent(inviteCode)}`, {
      headers: { "User-Agent": "WhatsApp/2.23.20.0" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (!match?.[1]) return null;
    const title = decodeBasicHtmlEntities(match[1]);
    if (!title || /^whatsapp\s+group\s+invite$/i.test(title)) {
      return null;
    }
    inviteTitleCache.set(inviteCode, { subject: title, fetchedAt: now });
    return title;
  } catch {
    return null;
  }
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

  const optionMeta = HOLD_ON_HOLD_GROUP_OPTIONS.find((g) => g.inviteCode === inviteCode);
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
        subject: (meta.subject || "").trim() || optionMeta?.label || "Grup On Hold",
        fetchedAt: now,
      };
      groupInviteCache.set(inviteCode, cached);
    } catch (err: any) {
      // Fallback: resolve title via allowlisted invite page and match against already-joined groups
      const fetchedTitle = await fetchAllowlistedGroupInviteTitle(inviteCode);
      const expectedSubject = (fetchedTitle || optionMeta?.label || "").trim();
      let matchedParticipating: { jid: string; subject: string } | null = null;

      try {
        const participating = await sock.groupFetchAllParticipating();
        if (participating && expectedSubject) {
          const targetNorm = expectedSubject.toLowerCase();
          for (const [jid, meta] of Object.entries(participating)) {
            const sub = ((meta as any)?.subject || "").trim();
            if (sub && sub.toLowerCase() === targetNorm) {
              matchedParticipating = { jid, subject: sub };
              confirmedJoinedGroups.add(jid);
              break;
            }
          }
        }
      } catch {
        // Ignore participating lookup fallback failure
      }

      if (matchedParticipating) {
        cached = {
          jid: matchedParticipating.jid,
          subject: matchedParticipating.subject,
          fetchedAt: now,
        };
        groupInviteCache.set(inviteCode, cached);
      } else if (ensureJoined) {
        // Last resort when actually sending: attempt groupAcceptInvite directly
        try {
          const joinedJid = await sock.groupAcceptInvite(inviteCode);
          if (joinedJid) {
            cached = {
              jid: joinedJid,
              subject: expectedSubject || "Grup On Hold",
              fetchedAt: now,
            };
            groupInviteCache.set(inviteCode, cached);
            confirmedJoinedGroups.add(joinedJid);
          }
        } catch {
          // Handled below
        }
      }

      if (!cached) {
        const rawMsg = err?.message || String(err);
        if (rawMsg.includes("410") || rawMsg.includes("404") || rawMsg.toLowerCase().includes("gone")) {
          throw new Error("Link undangan grup On Hold sudah kedaluwarsa atau dicabut.");
        }
        throw new Error(`Gagal memeriksa grup On Hold: ${rawMsg}`);
      }
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
  let participatingBySubject: Map<string, { jid: string; subject: string }> | null = null;

  const ensureParticipatingLoaded = async () => {
    if (participatingBySubject || !isConnected || !sock) return participatingBySubject;
    participatingBySubject = new Map();
    try {
      const participating = await sock.groupFetchAllParticipating();
      if (participating) {
        for (const [jid, meta] of Object.entries(participating)) {
          const sub = ((meta as any)?.subject || "").trim();
          if (sub) {
            participatingBySubject.set(sub.toLowerCase(), { jid, subject: sub });
          }
        }
      }
    } catch {
      // Ignore participating fetch warning
    }
    return participatingBySubject;
  };

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
        // Fallback to public invite title + participating match below
      }
    }

    const fetchedTitle = await fetchAllowlistedGroupInviteTitle(option.inviteCode);
    const subjectName = (fetchedTitle || option.label).trim();
    let matchedJid: string | null = null;

    if (isConnected) {
      const participating = await ensureParticipatingLoaded();
      const matched = participating?.get(subjectName.toLowerCase());
      if (matched) {
        matchedJid = matched.jid;
        confirmedJoinedGroups.add(matched.jid);
        groupInviteCache.set(option.inviteCode, {
          jid: matched.jid,
          subject: matched.subject,
          fetchedAt: Date.now(),
        });
      }
    }

    results.push({
      ...option,
      subject: subjectName,
      jid: matchedJid,
      resolved: Boolean(subjectName),
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


