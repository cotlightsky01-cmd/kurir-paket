import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc, getDoc } from "firebase/firestore";
import {
  connectWaGateway,
  getAutoSendState,
  getHoldGroupsStatus,
  getWaGatewayStatus,
  HoldBundlePartialError,
  initWaGatewayOnBoot,
  logoutWaGateway,
  pauseAutoSendQueue,
  requestWaPairingCode,
  resetAutoSendQueue,
  resumeAutoSendQueue,
  sendDirectWaMediaMessage,
  sendHoldCameraBundle,
  startAutoSendQueue,
  stopAutoSendQueue,
  WaGatewayNotConnectedError,
  type AutoSendInputItem,
  type AutoSendTemplates,
  type TempatCodItem,
} from "./server/waGateway";

// Prevent unexpected background async errors from terminating the server process
process.on('unhandledRejection', (reason, promise) => {
  console.warn('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err);
});

// Read Firebase config
let firebaseConfig: any = {};
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }
} catch (e) {
  console.warn("Could not read firebase-applet-config.json:", e);
}

let db: any = null;
if (firebaseConfig.projectId) {
  try {
    const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
    db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== "(default)"
      ? getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId)
      : getFirestore(firebaseApp);
  } catch (err) {
    console.error("Firebase init error in server.ts:", err);
  }
}

// Global model cooldown tracking to avoid repeating failed requests to rate-limited models
const modelCooldowns: Record<string, number> = {};

const ALL_OCR_MODELS = [
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite'
];

let lastOcrRequestTime = 0;
async function throttleOcrRequest(): Promise<void> {
  const MIN_INTERVAL_MS = 1500;
  const now = Date.now();
  const elapsed = now - lastOcrRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastOcrRequestTime = Date.now();
}

function markModelCooldown(modelName: string, err: any) {
  const errMsg = err?.message || String(err);

  // Blacklist 404 / NOT_FOUND / deprecated models permanently
  const isNotFound = errMsg.includes('404') || errMsg.includes('NOT_FOUND') || errMsg.includes('no longer available') || err?.status === 404;
  if (isNotFound) {
    modelCooldowns[modelName] = Date.now() + 86400000 * 30; // 30 days
    console.warn(`[Model Blacklist] Permanently disabled model ${modelName} because it returned 404/NOT_FOUND.`);
    return;
  }

  // Temporary 503 / UNAVAILABLE
  const isUnavailable = errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || err?.status === 503;
  if (isUnavailable) {
    modelCooldowns[modelName] = Date.now() + 15000; // 15 seconds
    console.warn(`[Model Cooldown] Marked ${modelName} on 15s cooldown due to 503 UNAVAILABLE.`);
    return;
  }

  // 429 / RESOURCE_EXHAUSTED
  const isRateLimit = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || err?.status === 429;
  if (isRateLimit) {
    const matchSec = errMsg.match(/retry in (\d+(\.\d+)?)s/i) || errMsg.match(/retryDelay["\s:]+["']?(\d+)s/i);
    let cooldownMs = 30000; // Default 30 seconds
    if (matchSec && matchSec[1]) {
      const sec = parseFloat(matchSec[1]);
      if (!isNaN(sec) && sec > 0) {
        cooldownMs = Math.ceil(sec * 1000) + 2000; // Add 2s buffer
      }
    }
    modelCooldowns[modelName] = Date.now() + cooldownMs;
    console.warn(`[Model Cooldown] Marked ${modelName} on cooldown for ${Math.round(cooldownMs / 1000)}s due to quota limit.`);
  }
}

async function getAvailableModels(): Promise<string[]> {
  const now = Date.now();
  const available = ALL_OCR_MODELS.filter(m => !modelCooldowns[m] || now >= modelCooldowns[m]);
  if (available.length > 0) {
    return available;
  }

  // If ALL models are currently on cooldown, wait for the one whose cooldown expires soonest
  const sorted = [...ALL_OCR_MODELS].sort((a, b) => (modelCooldowns[a] || 0) - (modelCooldowns[b] || 0));
  const earliestModel = sorted[0];
  const cooldownEnd = modelCooldowns[earliestModel] || Date.now();
  const waitMs = Math.max(1000, cooldownEnd - Date.now());

  console.warn(`[Model Cooldown] All Gemini models on quota limit cooldown. Pausing for ${Math.round(waitMs / 1000)}s for ${earliestModel} to recover...`);
  await new Promise(r => setTimeout(r, waitMs));

  return [earliestModel, ...ALL_OCR_MODELS.filter(m => m !== earliestModel)];
}

// Single item extraction with automatic retry until success
async function extractSingleItemWithRetry(img: { data: string; mimeType: string }): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      name: 'Pelanggan',
      phone: '081234567890',
      address: 'Jl. Sugihwaras, RT 02 RW 01',
      cod_amount: '35.000',
      package_count: '1'
    };
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });

  let attempts = 0;
  const maxAttempts = 2;

  while (attempts < maxAttempts) {
    attempts++;
    const modelsToTry = await getAvailableModels();

    for (const modelName of modelsToTry) {
      try {
        await throttleOcrRequest();
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: img.mimeType || 'image/jpeg',
                    data: img.data,
                  },
                },
                {
                  text: `You are an expert OCR parser for Indonesian courier receipts, shipping labels, and logistics app screens (such as SPX / Shopee Express "Order Info" screens and "Konfirmasi Paket Dengan Penerima Sama" popups).

Analyze the visual layout of the image carefully:

LAYOUT TYPE A: "Order Info" Screen (SPX / Courier App)
1. Receiver Information:
   - "name": Listed under "Receiver Information". MUST extract the FULL COMPLETE name exactly as written, INCLUDING any text in parentheses "()" (for example: "Azka (khotib)" MUST remain "Azka (khotib)", "Budi (2 paket)" MUST remain "Budi (2 paket)", "FAJRI" -> "FAJRI"). NEVER strip or omit parentheses!
   - "phone": Listed after "Tel:" (e.g. "+62895425469300" -> convert to "0895425469300"). Only extract visible phone numbers; if none visible, return "".
2. Address Extraction ("main_address", "recommended_address", "main_address_is_clue_only", "address"):
   - "main_address": Extract the FULL COMPLETE address text shown near the top below the tracking ID (below "SPXID..."), keeping ALL details (dusun/dukuh, RT/RW, desa, kecamatan, house numbers, middle postal code, and notes in parentheses like "(DEPAN MBG GAMBIRAN)"). ONLY remove the trailing regional suffix at the very end such as ", AMPEL, KAB. BOYOLALI, JAWA TENGAH" (or ", Ampel, Kab. Boyolali, Jawa Tengah, Indonesia" / trailing postal code at the very end).
   - "recommended_address": Extract the text under the "Alamat Rekomendasi" section if visible (also removing trailing ", Ampel, Kab. Boyolali, Jawa Tengah", trailing postal code, and "Indonesia" at the end). If there is no "Alamat Rekomendasi" section, return "".
   - "main_address_is_clue_only": Set to true ONLY IF "main_address" contains ONLY a landmark/direction/clue ("petunjuk alamat" without a real street/dusun/desa/RT/RW address, such as "Depan masjid", "Rumah cat hijau pagar hitam", "Sebelah warung", "Masuk gang sebelah SD") OR if "main_address" is empty after removing the trailing regional suffix. Set to false if "main_address" already contains an actual address (e.g. street/jalan, dusun/dk, desa, RT/RW, perumahan, etc.).
   - "address":
     * If "main_address_is_clue_only" is false (the top box already has an actual address): MUST use ONLY "main_address" and DO NOT include "Alamat Rekomendasi".
     * If "main_address_is_clue_only" is true (the top box ONLY has a petunjuk alamat / clue or is empty): MUST include "recommended_address" combined with the clue from "main_address" (e.g., "<main_address>, <recommended_address>" or "<recommended_address>" if main_address is empty), both without trailing "Ampel, Kab. Boyolali, Jawa Tengah".
3. COD Amount: Look for "Jumlah COD" badge or field (e.g. "135.460 IDR"). Extract as "135.460". If no COD mentioned or 0, return "NO COD".
4. Package Count: Default to "1" unless specified otherwise.

LAYOUT TYPE B: "Konfirmasi Paket Dengan Penerima Sama" Popup
1. Package Count & COD: Look at the prompt message "This receiver has X parcels totally pay amount Y IDR...".
   - Extract "package_count" as X (e.g. "5").
   - Extract "cod_amount" as Y (e.g. "2.379.852"). If 0 IDR, return "NO COD".
2. Address: Located in the light gray card (e.g. "HGJ3+MPH, Dusun 4, Ngadirojo..."). Extract completely without trailing "Ampel, Kab. Boyolali, Jawa Tengah", "Jawa Tengah", "Indonesia", or trailing postal code.
3. Receiver Info:
   - "name": Extract FULL COMPLETE name including any parentheses "()".
   - "phone": Listed after "Tel:" (e.g. "+62895383119920" -> convert to "0895383119920").

STRICT RULES:
- "name": MUST be complete and verbatim, INCLUDING any parentheses "()" like "Azka (khotib)" or "Siti (toko)".
- "phone": Format strictly as "08..." (convert "+628..." or "628..." to "08..."). If not present, return "".
- "address": MUST be complete without trailing "AMPEL, KAB. BOYOLALI, JAWA TENGAH" / "Ampel, Kab. Boyolali, Jawa Tengah" / "Indonesia" / trailing postal code at the end. Include "Alamat Rekomendasi" ONLY when the main address contains only a petunjuk alamat (clue) or is empty; NEVER include "Alamat Rekomendasi" when the main address already contains an address.
- "cod_amount": Numerical COD string with dots (e.g. "135.460") or "NO COD".
- "package_count": Parcel count as integer string (e.g. "1", "5").

Return JSON with keys: "name", "phone", "address", "main_address", "recommended_address", "main_address_is_clue_only", "cod_amount", "package_count".`
                },
              ],
            },
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                phone: { type: 'STRING' },
                address: { type: 'STRING' },
                main_address: { type: 'STRING' },
                recommended_address: { type: 'STRING' },
                main_address_is_clue_only: { type: 'BOOLEAN' },
                cod_amount: { type: 'STRING' },
                package_count: { type: 'STRING' },
              },
              required: ['name', 'address'],
            },
          },
        });

        const rawText = response.text || '';
        const match = rawText.match(/\{[\s\S]*\}/);
        const cleanJson = match ? match[0] : rawText;
        const parsed = JSON.parse(cleanJson);

        // Preserve full name including parentheses ()
        const cleanName = (parsed.name || '')
          .replace(/\s+/g, ' ')
          .trim();

        const cleanServerAddress = (addr: string): string => {
          if (!addr) return '';
          let result = addr.trim();
          let prev = '';
          while (result !== prev) {
            prev = result;
            result = result
              .replace(/(?:^|[,\s.;-]+)indonesia\s*$/i, '')
              .replace(/(?:^|[,\s.;-]+)(?:kode\s*pos\s*)?\d{5}\s*$/i, '')
              .replace(/(?:^|[,\s.;-]+)(?:jawa\s+tengah|jateng)\s*$/i, '')
              .replace(/(?:^|[,\s.;-]+)(?:(?:kec(?:amatan)?\.?\s*)?ampel[,\s.;-]+)?kab(?:upaten)?\.?\s*boyolali\s*$/i, '')
              .replace(/(?:^|[,\s.;-]+)(?:kec(?:amatan)?\.?\s*)?ampel[,\s.;-]+(?:kab(?:upaten)?\.?\s*)?boyolali(?:[,\s.;-]+(?:jawa\s+tengah|jateng))?\s*$/i, '')
              .replace(/(?:^|[,\.;]+)\s*(?:kec(?:amatan)?\.?\s*)?ampel\s*$/i, '')
              .trim();
          }
          result = result.replace(/(?:^|[,\s.;-]+)kode\s*pos\s*$/i, '').trim();
          return result
            .replace(/,\s*,+/g, ',')
            .replace(/\s+/g, ' ')
            .replace(/^[\s,;]+|[\s,;]+$/g, '')
            .trim();
        };

        const cleanMain = cleanServerAddress(parsed.main_address || parsed.address || '');
        const cleanRec = cleanServerAddress(parsed.recommended_address || '');

        const hasRealAddressInMain = /\b(?:rt\.?\s*\d+|rw\.?\s*\d+|rt\s*\/?\s*rw|dk\.?|dukuh|dusun|dsn\.?|desa|ds\.?|kel\.?|kelurahan|kec\.?|kecamatan|jl\.?|jalan|jln\.?|perum(?:ahan)?|cluster|komplek|kp\.?|kampung)\b/i.test(cleanMain);
        const isClueOnly = !cleanMain || (!hasRealAddressInMain && parsed.main_address_is_clue_only === true);

        let cleanAddress = cleanMain;
        if (isClueOnly && cleanRec) {
          if (!cleanMain) {
            cleanAddress = cleanRec;
          } else if (cleanRec.toLowerCase().includes(cleanMain.toLowerCase())) {
            cleanAddress = cleanRec;
          } else if (cleanMain.toLowerCase().includes(cleanRec.toLowerCase())) {
            cleanAddress = cleanMain;
          } else {
            cleanAddress = `${cleanMain}, ${cleanRec}`;
          }
        } else if (!cleanAddress && parsed.address) {
          cleanAddress = cleanServerAddress(parsed.address);
        }

        let cleanPhone = (parsed.phone || '').trim();
        if (cleanPhone.startsWith('+62')) {
          cleanPhone = '0' + cleanPhone.slice(3);
        } else if (cleanPhone.startsWith('62') && cleanPhone.length > 9) {
          cleanPhone = '0' + cleanPhone.slice(2);
        }

        let pkgCount = parsed.package_count ? String(parsed.package_count).replace(/\D/g, '') : '1';
        if (!pkgCount || pkgCount === '0') pkgCount = '1';

        if (cleanName || cleanAddress) {
          return {
            name: cleanName || 'Pelanggan',
            phone: cleanPhone,
            address: cleanAddress,
            cod_amount: parsed.cod_amount || 'NO COD',
            package_count: pkgCount,
          };
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        const isRateLimit = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || err?.status === 429;
        console.warn(`[Server OCR] Attempt ${attempts} model ${modelName} error:`, errMsg);
        if (isRateLimit) {
          markModelCooldown(modelName, err);
        }
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  return null;
}

function sanitizeForServerFirestore(obj: any): any {
  if (obj === undefined) return null;
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForServerFirestore);
  const clean: Record<string, any> = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] !== undefined) {
      clean[k] = sanitizeForServerFirestore(obj[k]);
    }
  }
  return clean;
}

function prepareServerFirestorePayload(payload: any): any {
  let clean = sanitizeForServerFirestore(payload);
  if (clean.bulkItems && Array.isArray(clean.bulkItems)) {
    clean.bulkItems = clean.bulkItems.map((item: any) => {
      if (item.status === 'completed' || (item.image_url && (item.image_url.length > 20000 || item.image_url.startsWith('data:image')) && (item.name || item.address || item.phone))) {
        return { ...item, image_url: '' };
      }
      return item;
    });
  }
  return clean;
}

let isServerProcessing = false;
let isServerPaused = false;
let serverQuotaExceededCooldownUntil = 0;

async function triggerServerBulkProcess() {
  if (!db || isServerProcessing) return;
  if (Date.now() < serverQuotaExceededCooldownUntil) {
    return;
  }
  isServerPaused = false;
  isServerProcessing = true;

  try {
    const docRef = doc(db, 'app_data', 'global');
    let docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      isServerProcessing = false;
      return;
    }

    let data = docSnap.data();
    let bulkItems: any[] = data.bulkItems || [];

    let itemsToProcess = bulkItems.filter(i => {
      if (i.status === 'completed') return false;
      const hasData = Boolean(
        (i.name && i.name.trim() !== '' && i.name !== 'Tanpa Nama' && i.name !== 'Pelanggan') ||
        (i.address && i.address.trim() !== '') ||
        (i.phone && i.phone.trim() !== '')
      );
      const isImageUnavailable = !i.image_url || !i.image_url.startsWith('data:image');

      if (hasData || isImageUnavailable) {
        i.status = 'completed';
        i.image_url = '';
        return false;
      }
      return i.status === 'processing' || i.status === 'pending';
    });

    if (itemsToProcess.length === 0) {
      isServerProcessing = false;
      return;
    }

    console.log(`[Server Queue] Starting background parallel generation for ${itemsToProcess.length} items...`);

    const claimedIds = new Set<string>();

    itemsToProcess.sort((a, b) => (a.order || 0) - (b.order || 0));

    const getNextUnclaimedItem = (direction: 'top' | 'bottom'): any | null => {
      if (direction === 'top') {
        for (let i = 0; i < itemsToProcess.length; i++) {
          const item = itemsToProcess[i];
          if (!claimedIds.has(item.id)) {
            claimedIds.add(item.id);
            return item;
          }
        }
      } else {
        for (let i = itemsToProcess.length - 1; i >= 0; i--) {
          const item = itemsToProcess[i];
          if (!claimedIds.has(item.id)) {
            claimedIds.add(item.id);
            return item;
          }
        }
      }
      return null;
    };

    const worker = async (workerId: number, direction: 'top' | 'bottom') => {
      if (workerId > 0) {
        await new Promise(r => setTimeout(r, 500));
      }

      while (!isServerPaused) {
        const item = getNextUnclaimedItem(direction);
        if (!item) break;

        // Check latest Firestore snap before doing OCR call to ensure item wasn't completed or sent to sending already
        try {
          const freshSnap = await getDoc(docRef);
          if (freshSnap.exists()) {
            const freshData = freshSnap.data();
            const freshBulkItems: any[] = freshData.bulkItems || [];
            const freshItem = freshBulkItems.find(b => b.id === item.id);
            if (!freshItem) {
              console.log(`[Server Worker ${workerId} (${direction})] Item ${item.id} is no longer in bulkItems. Skipping generate!`);
              continue;
            }
            const hasData = Boolean(
              (freshItem.name && freshItem.name.trim() !== '' && freshItem.name !== 'Tanpa Nama' && freshItem.name !== 'Pelanggan') ||
              (freshItem.address && freshItem.address.trim() !== '') ||
              (freshItem.phone && freshItem.phone.trim() !== '') ||
              (!freshItem.image_url || !freshItem.image_url.startsWith('data:image'))
            );
            if (freshItem.status === 'completed' || hasData) {
              console.log(`[Server Worker ${workerId} (${direction})] Item ${item.id} ALREADY has data obtained. Skipping duplicate generate!`);
              continue;
            }
          }
        } catch (checkErr) {
          console.warn(`[Server Worker ${workerId} (${direction})] Fresh snap check error for item ${item.id}:`, checkErr);
        }

        console.log(`[Server Worker ${workerId} (${direction})] Extracting item ${item.id}...`);

        const urlParts = (item.image_url || '').split(',');
        const mimeType = urlParts[0]?.match(/:(.*?);/)?.[1] || 'image/jpeg';
        const base64Data = urlParts[1] || '';

        let extracted: any = null;
        try {
          extracted = await extractSingleItemWithRetry({ data: base64Data, mimeType });
        } catch (err) {
          console.warn(`[Server Worker ${workerId} (${direction})] Exception extracting item ${item.id}:`, err);
        }

        if (extracted && (extracted.name || extracted.address || extracted.phone)) {
          // Update Firestore item state
          try {
            const latestSnap = await getDoc(docRef);
            if (latestSnap.exists()) {
              const currentData = latestSnap.data();
              const currentBulkItems: any[] = currentData.bulkItems || [];

              const updatedItems = currentBulkItems.map(b => {
                if (b.id === item.id) {
                  return {
                    ...b,
                    name: extracted.name || b.name || '',
                    phone: extracted.phone || b.phone || '',
                    address: extracted.address || b.address || '',
                    cod_amount: extracted.cod_amount || b.cod_amount || 'NO COD',
                    package_count: extracted.package_count || b.package_count || '1',
                    status: 'completed',
                    image_url: '',
                    error_message: ''
                  };
                }
                return b;
              });

              const payloadToSave = prepareServerFirestorePayload({
                ...currentData,
                bulkItems: updatedItems,
                updatedAt: new Date().toISOString()
              });

              await setDoc(docRef, payloadToSave, { merge: true });

              console.log(`[Server Worker ${workerId} (${direction})] Item ${item.id} successfully completed!`);
            }
          } catch (fireErr: any) {
            const errMsg = fireErr?.message || String(fireErr);
            const isQuota = errMsg.includes('resource-exhausted') || errMsg.includes('Quota limit exceeded') || fireErr?.code === 'resource-exhausted';
            if (isQuota) {
              console.warn(`[Server Worker ${workerId} (${direction})] Firestore daily write quota limit reached. Pausing cloud setDoc writes for 3 minutes.`);
              serverQuotaExceededCooldownUntil = Date.now() + 180000;
              break;
            } else {
              console.warn(`[Server Worker ${workerId} (${direction})] Firestore setDoc write error for item ${item.id}:`, fireErr);
            }
          }
          const delayMs = 3500 + Math.floor(Math.random() * 1000);
          await new Promise(r => setTimeout(r, delayMs));
        } else {
          item.requeueCount = (item.requeueCount || 0) + 1;
          if (item.requeueCount < 5) {
            console.warn(`[Server Worker ${workerId} (${direction})] Item ${item.id} touched limit. Pausing 10s before unclaiming...`);
            await new Promise(r => setTimeout(r, 10000));
            claimedIds.delete(item.id);
          } else {
            console.warn(`[Server Worker ${workerId} (${direction})] Item ${item.id} reached max re-queues, marking completed with default fallback.`);
            try {
              const latestSnap = await getDoc(docRef);
              if (latestSnap.exists()) {
                const currentData = latestSnap.data();
                const currentBulkItems: any[] = currentData.bulkItems || [];

                const updatedItems = currentBulkItems.map(b => {
                  if (b.id === item.id) {
                    return {
                      ...b,
                      name: b.name || 'Pelanggan',
                      phone: b.phone || '',
                      address: b.address || 'Alamat Penerima',
                      cod_amount: b.cod_amount || 'NO COD',
                      package_count: b.package_count || '1',
                      status: 'completed',
                      image_url: '',
                      error_message: ''
                    };
                  }
                  return b;
                });

                const payloadToSave = prepareServerFirestorePayload({
                  ...currentData,
                  bulkItems: updatedItems,
                  updatedAt: new Date().toISOString()
                });

                await setDoc(docRef, payloadToSave, { merge: true });
              }
            } catch (fireErr: any) {
              const errMsg = fireErr?.message || String(fireErr);
              const isQuota = errMsg.includes('resource-exhausted') || errMsg.includes('Quota limit exceeded') || fireErr?.code === 'resource-exhausted';
              if (isQuota) {
                console.warn(`[Server Worker ${workerId} (${direction})] Firestore daily write quota limit reached. Pausing cloud setDoc writes for 3 minutes.`);
                serverQuotaExceededCooldownUntil = Date.now() + 180000;
                break;
              } else {
                console.warn(`[Server Worker ${workerId} (${direction})] Firestore fallback setDoc write error:`, fireErr);
              }
            }
          }
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    };

    const workerTop = worker(0, 'top');
    const workerBottom = itemsToProcess.length > 1 ? worker(1, 'bottom') : null;

    await Promise.all([workerTop, workerBottom].filter(Boolean));

    console.log(`[Server Queue] Finished parallel bulk processing batch.`);
  } catch (err) {
    console.error('[Server Queue] Error in triggerServerBulkProcess:', err);
  } finally {
    isServerProcessing = false;
  }
}

// Background Firestore snapshot polling removed: cloud sync now runs strictly 1x/day on Day Reset.

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Support up to 50MB payload for multi-image base64 uploads
  app.use(express.json({ limit: '50mb' }));

  // API health endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Start background bulk generate queue endpoint
  app.post("/api/start-bulk-generate", (req, res) => {
    isServerPaused = false;
    triggerServerBulkProcess();
    res.json({ status: "started" });
  });

  // Pause/Stop background bulk generate queue endpoint
  const handleStopOrPause = async (req: express.Request, res: express.Response) => {
    isServerPaused = true;
    isServerProcessing = false;
    try {
      if (db) {
        const docRef = doc(db, 'app_data', 'global');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          const bulkItems: any[] = data.bulkItems || [];
          const updatedItems = bulkItems.map(i => i.status === 'processing' ? { ...i, status: 'pending' } : i);
          await setDoc(docRef, prepareServerFirestorePayload({ ...data, bulkItems: updatedItems, updatedAt: new Date().toISOString() }), { merge: true });
        }
      }
    } catch (err) {
      console.warn('[Server API] Error handling stop/pause bulk generate:', err);
    }
    res.json({ status: "stopped" });
  };

  app.post("/api/pause-bulk-generate", handleStopOrPause);
  app.post("/api/stop-bulk-generate", handleStopOrPause);

// Server-side Gemini API proxy for batch label extraction
  app.post("/api/extract-batch", async (req, res) => {
    try {
      const { imageData } = req.body || {};
      if (!Array.isArray(imageData) || imageData.length === 0) {
        return res.status(400).json({ error: "imageData array is required" });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        const simulated = imageData.map((_: any, idx: number) => ({
          name: `Pelanggan ${idx + 1}`,
          phone: `08123456789${idx}`,
          address: `Jl. Melati No. ${idx + 10}, Desa Sugihwaras, RT 02 RW 01`,
          cod_amount: idx % 2 === 0 ? '50.000' : 'NO COD',
          package_count: '1'
        }));
        return res.json({ results: simulated });
      }

      // Process items sequentially to prevent quota 429 bursts on free tier
      const results: any[] = [];
      for (let i = 0; i < imageData.length; i++) {
        const img = imageData[i];
        const itemRes = await extractSingleItemWithRetry(img);
        if (itemRes) {
          results.push(itemRes);
        } else {
          results.push({
            name: '',
            phone: '',
            address: '',
            cod_amount: 'NO COD',
            package_count: '1',
            error: 'Gagal mengekstrak data dari gambar.'
          });
        }
        if (i < imageData.length - 1) {
          await new Promise(r => setTimeout(r, 800));
        }
      }

      return res.json({ results });
    } catch (err: any) {
      console.error('API Error /api/extract-batch:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Server error' });
    }
  });

  // --- WhatsApp Open Source (Baileys) Auto-Send Endpoints (Sending Module Only) ---
  app.get("/api/wa/status", (_req, res) => {
    res.json({
      gateway: getWaGatewayStatus(),
      autoSend: getAutoSendState(),
    });
  });

  app.post("/api/wa/connect", async (_req, res) => {
    try {
      const gateway = await connectWaGateway();
      res.json({
        gateway,
        autoSend: getAutoSendState(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Gagal menghubungkan WhatsApp." });
    }
  });

  app.post("/api/wa/pairing-code", async (req, res) => {
    try {
      const rawPhone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
      if (!rawPhone || rawPhone.length > 30) {
        return res.status(400).json({ error: "Nomor WhatsApp tidak valid." });
      }
      const result = await requestWaPairingCode(rawPhone);
      return res.json({
        code: result.code,
        gateway: getWaGatewayStatus(),
      });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "Gagal meminta kode pairing." });
    }
  });

  app.post("/api/wa/logout", async (_req, res) => {
    try {
      const gateway = await logoutWaGateway();
      return res.json({
        gateway,
        autoSend: getAutoSendState(),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Gagal memutuskan koneksi WhatsApp." });
    }
  });

  app.get("/api/wa/auto-send/status", (_req, res) => {
    res.json({
      gateway: getWaGatewayStatus(),
      autoSend: getAutoSendState(),
    });
  });

  const parseAutoSendPayload = (body: any) => {
    const rawItems = Array.isArray(body?.items) ? body.items : [];
    const items: AutoSendInputItem[] = rawItems
      .filter((it: any) => it && typeof it.id === "string")
      .slice(0, 500)
      .map((it: any) => ({
        id: String(it.id).slice(0, 120),
        name: typeof it.name === "string" ? it.name.slice(0, 200) : "Pelanggan",
        phone: typeof it.phone === "string" ? it.phone.slice(0, 40) : "",
        cleanPhone: typeof it.cleanPhone === "string" ? it.cleanPhone.slice(0, 40) : "",
        address: typeof it.address === "string" ? it.address.slice(0, 500) : "",
        cod: typeof it.cod === "string" ? it.cod.slice(0, 60) : "NO COD",
        waTemplateSent: Boolean(it.waTemplateSent),
        titipLocationName:
          typeof it.titipLocationName === "string" ? it.titipLocationName.slice(0, 120) : undefined,
      }));

    const rawTemplates = body?.templates || {};
    const templates: AutoSendTemplates = {
      cod: typeof rawTemplates.cod === "string" ? rawTemplates.cod.slice(0, 1500) : "",
      nocod: typeof rawTemplates.nocod === "string" ? rawTemplates.nocod.slice(0, 1500) : "",
      titip: typeof rawTemplates.titip === "string" ? rawTemplates.titip.slice(0, 1500) : "",
      codOnlyNoShareloc:
        typeof rawTemplates.codOnlyNoShareloc === "string"
          ? rawTemplates.codOnlyNoShareloc.slice(0, 1500)
          : "",
    };

    const rawLocs = Array.isArray(body?.tempatCodList) ? body.tempatCodList : [];
    const tempatCodList: TempatCodItem[] = rawLocs
      .filter((loc: any) => loc && typeof loc.name === "string")
      .slice(0, 100)
      .map((loc: any) => ({
        id: String(loc.id || "").slice(0, 60),
        name: String(loc.name).slice(0, 120),
        targetAddress: typeof loc.targetAddress === "string" ? loc.targetAddress.slice(0, 300) : "",
      }));

    return { rawItemsCount: rawItems.length, items, templates, tempatCodList };
  };

  app.post("/api/wa/auto-send/start", (req, res) => {
    try {
      const { rawItemsCount, items, templates, tempatCodList } = parseAutoSendPayload(req.body);
      if (rawItemsCount === 0 || rawItemsCount > 500 || items.length === 0) {
        return res.status(400).json({ error: "Daftar pengiriman modul Sending kosong atau melebihi batas." });
      }

      const autoSend = startAutoSendQueue(items, templates, tempatCodList);
      return res.json({
        gateway: getWaGatewayStatus(),
        autoSend,
      });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "Gagal memulai kirim otomatis." });
    }
  });

  app.post("/api/wa/auto-send/pause", (_req, res) => {
    const autoSend = pauseAutoSendQueue("Dijeda oleh pengguna");
    res.json({
      gateway: getWaGatewayStatus(),
      autoSend,
    });
  });

  app.post("/api/wa/auto-send/resume", (req, res) => {
    try {
      const hasBodyItems = Array.isArray(req.body?.items) && req.body.items.length > 0;
      const { items, templates, tempatCodList } = parseAutoSendPayload(req.body);
      const autoSend = resumeAutoSendQueue(
        hasBodyItems ? items : undefined,
        req.body?.templates ? templates : undefined,
        Array.isArray(req.body?.tempatCodList) ? tempatCodList : undefined
      );
      return res.json({
        gateway: getWaGatewayStatus(),
        autoSend,
      });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "Gagal melanjutkan kirim otomatis." });
    }
  });

  app.post("/api/wa/auto-send/reset", (_req, res) => {
    const autoSend = resetAutoSendQueue();
    res.json({
      gateway: getWaGatewayStatus(),
      autoSend,
    });
  });

  app.post("/api/wa/auto-send/stop", (_req, res) => {
    const autoSend = stopAutoSendQueue("Dihentikan oleh pengguna");
    res.json({
      gateway: getWaGatewayStatus(),
      autoSend,
    });
  });

  app.post("/api/wa/send-media", async (req, res) => {
    try {
      const targetPhone =
        typeof req.body?.targetPhone === "string" ? req.body.targetPhone.trim().slice(0, 40) : "";
      const imageDataUrl =
        typeof req.body?.imageDataUrl === "string" ? req.body.imageDataUrl.trim() : "";
      const caption =
        typeof req.body?.caption === "string" ? req.body.caption.slice(0, 2500) : "";

      if (!targetPhone) {
        return res.status(400).json({ error: "Nomor tujuan WhatsApp belum diisi." });
      }
      if (!imageDataUrl || imageDataUrl.length > 15_000_000) {
        return res.status(400).json({ error: "Data foto tidak valid atau terlalu besar." });
      }

      const result = await sendDirectWaMediaMessage({
        targetPhone,
        imageDataUrl,
        caption,
      });

      return res.json({
        ok: true,
        ...result,
        gateway: getWaGatewayStatus(),
      });
    } catch (err: any) {
      const statusCode = err instanceof WaGatewayNotConnectedError ? 409 : 400;
      return res.status(statusCode).json({
        ok: false,
        notConnected: err instanceof WaGatewayNotConnectedError,
        error: err?.message || "Gagal mengirim foto ke nomor tujuan WhatsApp.",
      });
    }
  });

  app.get("/api/wa/hold-groups", async (_req, res) => {
    try {
      const groups = await getHoldGroupsStatus();
      return res.json({
        ok: true,
        groups,
        gateway: getWaGatewayStatus(),
      });
    } catch (err: any) {
      return res.status(500).json({
        ok: false,
        error: err?.message || "Gagal memuat daftar grup On Hold.",
      });
    }
  });

  app.post("/api/wa/send-hold-bundle", async (req, res) => {
    try {
      const targetPhone =
        typeof req.body?.targetPhone === "string" ? req.body.targetPhone.trim().slice(0, 40) : "";
      const imageDataUrl =
        typeof req.body?.imageDataUrl === "string" ? req.body.imageDataUrl.trim() : "";
      const templateCaption =
        typeof req.body?.templateCaption === "string" ? req.body.templateCaption.slice(0, 2500) : "";
      const groupInviteUrl =
        typeof req.body?.groupInviteUrl === "string" ? req.body.groupInviteUrl.trim().slice(0, 300) : "";
      const ohReturnCaption =
        typeof req.body?.ohReturnCaption === "string" ? req.body.ohReturnCaption.trim().slice(0, 500) : "";

      if (!targetPhone) {
        return res.status(400).json({ ok: false, error: "Nomor terdaftar pelanggan belum diisi." });
      }
      if (!imageDataUrl || imageDataUrl.length > 15_000_000) {
        return res.status(400).json({ ok: false, error: "Data foto tidak valid atau terlalu besar." });
      }
      if (!templateCaption.trim()) {
        return res.status(400).json({ ok: false, error: "Keterangan template pesan pelanggan masih kosong." });
      }
      if (!groupInviteUrl) {
        return res.status(400).json({ ok: false, error: "Grup On Hold tujuan belum dipilih." });
      }
      if (!ohReturnCaption) {
        return res.status(400).json({ ok: false, error: "Keterangan OH / Return masih kosong." });
      }

      const result = await sendHoldCameraBundle({
        targetPhone,
        imageDataUrl,
        templateCaption,
        groupInviteUrl,
        ohReturnCaption,
      });

      return res.json({
        ok: true,
        ...result,
        gateway: getWaGatewayStatus(),
      });
    } catch (err: any) {
      if (err instanceof WaGatewayNotConnectedError) {
        return res.status(409).json({
          ok: false,
          notConnected: true,
          buyerSent: false,
          groupSent: false,
          error: err.message,
        });
      }
      if (err instanceof HoldBundlePartialError) {
        return res.status(502).json({
          ok: false,
          partialError: true,
          buyerSent: err.buyerSent,
          groupSent: err.groupSent,
          targetPhone: err.targetPhone,
          groupSubject: err.groupSubject,
          error: err.message,
          gateway: getWaGatewayStatus(),
        });
      }
      return res.status(400).json({
        ok: false,
        buyerSent: false,
        groupSent: false,
        error: err?.message || "Gagal mengirim 2 pesan Hold otomatis.",
      });
    }
  });

  // Vite middleware for development vs static serve for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    initWaGatewayOnBoot();
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
