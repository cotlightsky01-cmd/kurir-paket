import { Customer, TempatCodLocation } from '../types';

// Recursively clean undefined values so Firestore setDoc does not throw invalid data errors
export function sanitizeForFirestore(obj: any): any {
  if (obj === undefined) {
    return null;
  }
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore);
  }
  const cleanObj: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== undefined) {
      cleanObj[key] = sanitizeForFirestore(val);
    }
  }
  return cleanObj;
}

// Discard base64 image_url once a bulk item is completed
export function stripCompletedBulkImages<T extends { status?: string; image_url?: string }>(items: T[]): T[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (item && item.status === 'completed' && item.image_url) {
      return { ...item, image_url: '' };
    }
    return item;
  });
}

export function normalizeSyncName(name?: string): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeSyncPhone(phone?: string, cleanPhone?: string): string {
  const source = cleanPhone || phone || '';
  const cleaned = cleanPhoneNumber(source);
  return cleaned || source.replace(/\D/g, '');
}

export function getNamePhoneSyncKey(item: { id?: string; name?: string; phone?: string; cleanPhone?: string }): string {
  const normName = normalizeSyncName(item?.name);
  const normPhone = normalizeSyncPhone(item?.phone, item?.cleanPhone);
  if (!normName && !normPhone) {
    return `id:${item?.id || ''}`;
  }
  return `${normName}|${normPhone}`;
}

export function isSameRecordByNameAndPhone(
  a?: { id?: string; name?: string; phone?: string; cleanPhone?: string } | null,
  b?: { id?: string; name?: string; phone?: string; cleanPhone?: string } | null
): boolean {
  if (!a || !b) return false;
  const nameA = normalizeSyncName(a.name);
  const nameB = normalizeSyncName(b.name);
  const phoneA = normalizeSyncPhone(a.phone, a.cleanPhone);
  const phoneB = normalizeSyncPhone(b.phone, b.cleanPhone);

  if (!nameA && !phoneA && !nameB && !phoneB) {
    return Boolean(a.id && b.id && a.id === b.id);
  }
  return nameA === nameB && phoneA === phoneB;
}

export function areRecordListsMatchedByNameAndPhone<
  T extends { id?: string; name?: string; phone?: string; cleanPhone?: string; status?: string }
>(listA: T[], listB: T[]): boolean {
  if (listA === listB) return true;
  if (!Array.isArray(listA) || !Array.isArray(listB)) return false;
  if (listA.length !== listB.length) return false;

  for (let i = 0; i < listA.length; i++) {
    const a = listA[i];
    const b = listB[i];
    if (!isSameRecordByNameAndPhone(a, b)) return false;
    if ((a.status || '') !== (b.status || '')) return false;
  }
  return true;
}

export function buildFocusedSyncSignature(payload: {
  customers?: Array<{ id?: string; name?: string; phone?: string; cleanPhone?: string; status?: string }>;
  bulkItems?: Array<{ id?: string; name?: string; phone?: string; status?: string }>;
  msgTemplateCod?: string;
  msgTemplateNoCod?: string;
  msgTemplateTitip?: string;
  tempatCodList?: TempatCodLocation[];
  waReportNumber?: string;
}): string {
  const custSig = (payload.customers || []).map((c) => `${getNamePhoneSyncKey(c)}@${c.status || ''}`);
  const bulkSig = (payload.bulkItems || []).map((b) => `${getNamePhoneSyncKey(b)}@${b.status || ''}`);
  return JSON.stringify({
    customers: custSig,
    bulkItems: bulkSig,
    msgTemplateCod: payload.msgTemplateCod || '',
    msgTemplateNoCod: payload.msgTemplateNoCod || '',
    msgTemplateTitip: payload.msgTemplateTitip || '',
    tempatCodList: (payload.tempatCodList || []).map((t) => `${t.id}:${t.name}:${t.targetAddress}`),
    waReportNumber: payload.waReportNumber || '',
  });
}

// Safely format and shrink Firestore document payload to keep payload lightweight (<50KB) for instant real-time sync
export function prepareFirestorePayload(payload: any): any {
  let clean = sanitizeForFirestore(payload);

  if (clean.bulkItems && Array.isArray(clean.bulkItems)) {
    clean.bulkItems = clean.bulkItems.map((item: any) => {
      let updated = { ...item };
      // Automatically discard base64 / placeholder image_url once bulk item is completed or extracted
      const hasExtractedData = Boolean(
        (updated.name && updated.name !== 'Tanpa Nama' && updated.name !== 'Pelanggan') ||
        updated.address ||
        updated.phone
      );
      if (
        updated.status === 'completed' ||
        (hasExtractedData && updated.image_url && (updated.image_url.length > 20000 || updated.image_url.startsWith('data:image')))
      ) {
        updated.image_url = '';
      }
      return updated;
    });
  }

  if (clean.customers && Array.isArray(clean.customers)) {
    clean.customers = clean.customers.map((cust: any) => {
      let updatedCust = { ...cust };
      if (updatedCust.photoUrl && (updatedCust.photoUrl.length > 15000 || updatedCust.photoUrl.startsWith('data:image'))) {
        updatedCust.photoUrl = null;
      }
      if (updatedCust.proofPhoto && (updatedCust.proofPhoto.length > 15000 || updatedCust.proofPhoto.startsWith('data:image'))) {
        updatedCust.proofPhoto = null;
      }
      if (updatedCust.photos && Array.isArray(updatedCust.photos)) {
        updatedCust.photos = updatedCust.photos.filter((p: string) => p && p.length <= 15000 && !p.startsWith('data:image'));
      }
      if (updatedCust.sendingPhotos && Array.isArray(updatedCust.sendingPhotos)) {
        updatedCust.sendingPhotos = updatedCust.sendingPhotos.filter((p: string) => p && p.length <= 15000 && !p.startsWith('data:image'));
      }
      if (updatedCust.holdPhotos && Array.isArray(updatedCust.holdPhotos)) {
        updatedCust.holdPhotos = updatedCust.holdPhotos.filter((p: string) => p && p.length <= 15000 && !p.startsWith('data:image'));
      }
      return updatedCust;
    });
  }

  // Sanitize archived customer items so app_data/archived_customers never breaches Firestore 1MB limit
  if (clean.items && Array.isArray(clean.items)) {
    // 1. Deduplicate by ID
    const uniqueItems = deduplicateById(clean.items);
    // 2. Strip all photos, base64 strings, and unnecessary bloated data
    clean.items = uniqueItems.slice(0, 1500).map((cust: any) => {
      return {
        id: cust.id || `arch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: cust.name || 'Pelanggan',
        phone: cust.phone || '',
        cleanPhone: cust.cleanPhone || '',
        address: cust.address || '',
        cod: cust.cod || 'NO COD',
        status: cust.status || 'modul2',
        completedAt: cust.completedAt || cust.timestamp || Date.now(),
        timestamp: cust.timestamp || Date.now(),
        paymentType: cust.paymentType || undefined,
        originalIndex: cust.originalIndex || undefined
      };
    });
  }

  return clean;
}

// Safely deduplicate an array of objects by id to prevent React key collision errors
export function deduplicateById<T extends { id: string }>(items: T[]): T[] {
  if (!items || !Array.isArray(items)) return [];
  const seen = new Set<string>();
  const result: T[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object') continue;
    let id = item.id;
    if (!id || typeof id !== 'string' || id.trim() === '') {
      id = `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${i}`;
      seen.add(id);
      result.push({ ...item, id });
      continue;
    }
    const cleanId = String(id).trim();
    if (!seen.has(cleanId)) {
      seen.add(cleanId);
      result.push({ ...item, id: cleanId });
    }
  }
  return result;
}

/**
 * Inserts a Customer sent from Filling into the customers list while preserving
 * its original Filling batch position (fillingBatchId + fillingOrder) instead of
 * forcing it to the top or end when sent in multiple partial batches.
 */
export function insertCustomerPreservingOrder(
  prevCustomers: Customer[],
  newCustomer: Customer
): Customer[] {
  const cleanPrev = deduplicateById(prevCustomers);
  if (cleanPrev.some((c) => c.id === newCustomer.id)) {
    return cleanPrev;
  }

  const batchId = newCustomer.fillingBatchId;
  const targetOrder = newCustomer.fillingOrder;

  if (batchId && typeof targetOrder === 'number' && Number.isFinite(targetOrder)) {
    const sameBatchIndices: number[] = [];
    for (let i = 0; i < cleanPrev.length; i++) {
      if (cleanPrev[i].fillingBatchId === batchId) {
        sameBatchIndices.push(i);
      }
    }

    if (sameBatchIndices.length > 0) {
      const insertBeforeIdx = sameBatchIndices.find((idx) => {
        const existingOrder = cleanPrev[idx].fillingOrder;
        return typeof existingOrder === 'number' && existingOrder > targetOrder;
      });

      const next = [...cleanPrev];
      if (insertBeforeIdx !== undefined) {
        next.splice(insertBeforeIdx, 0, newCustomer);
      } else {
        const lastBatchIdx = sameBatchIndices[sameBatchIndices.length - 1];
        next.splice(lastBatchIdx + 1, 0, newCustomer);
      }
      return deduplicateById(next);
    }
  }

  return deduplicateById([...cleanPrev, newCustomer]);
}

// Client-side canvas image compressor to convert large photo uploads/captures to lightweight JPEGs
export function compressImageDataUrl(dataUrl: string, maxWidth = 900, maxHeight = 900, quality = 0.55): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl || !dataUrl.startsWith('data:image')) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxWidth || height > maxHeight) {
        if (width > height) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Synchronously convert a Data URL to a File object so navigator.share preserves user gesture activation
export function dataUrlToFile(dataUrl: string, baseFileName: string): File | null {
  try {
    if (!dataUrl || !dataUrl.startsWith('data:')) return null;
    const parts = dataUrl.split(',');
    if (parts.length < 2) return null;
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mimeType = mimeMatch?.[1] || 'image/jpeg';
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const safeName = (baseFileName || 'paket').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 32);
    return new File([u8arr], `paket_${safeName}.${ext}`, { type: mimeType });
  } catch {
    return null;
  }
}

// Safe LocalStorage wrapper to prevent quota exceeded exceptions
export function isIncompleteCustomer(c: Customer): boolean {
  const cleanAddr = (c.address || '').trim();
  const cleanPh = (c.phone || '').trim();
  const digits = (c.cleanPhone || cleanPh).replace(/\D/g, '');

  const hasNoAddress = !cleanAddr || cleanAddr === '-' || cleanAddr.length < 3;
  const hasNoPhone = !cleanPh || cleanPh === '-' || digits.length < 6;

  return hasNoAddress || hasNoPhone;
}

export function safeGetLocalStorage<T>(key: string, defaultValue: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function safeSetLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn(`localStorage.setItem failed for key "${key}":`, err);
    try {
      if (key === 'kurir_parser_customers') {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          // Strip large base64 image strings if storage quota is hit
          const sanitized = parsed.map(item => ({
            ...item,
            photoUrl: item.photoUrl && item.photoUrl.length > 1000 ? undefined : item.photoUrl,
            proofPhoto: item.proofPhoto && item.proofPhoto.length > 1000 ? undefined : item.proofPhoto,
          }));
          localStorage.setItem(key, JSON.stringify(sanitized));
        }
      }
    } catch {
      // Ignore fallback errors
    }
  }
}

// Clean address string: keep full address complete, only stripping trailing regional suffixes
// (Ampel, Kab. Boyolali, Jawa Tengah, Indonesia, and trailing postal code at the end)
export function cleanAddressText(address: string): string {
  if (!address) return '';
  let result = address.trim();

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
}

// Keep full name complete including parentheses ()
export function cleanPureName(name: string): string {
  if (!name) return '';
  return name
    .replace(/\s+/g, ' ')
    .trim();
}

// Phone cleaning function for WhatsApp API
export function cleanPhoneNumber(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.replace(/[^\d]/g, ''); // strictly numbers
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.substring(1);
  } else if (cleaned.startsWith('8')) {
    cleaned = '62' + cleaned;
  }
  return cleaned;
}

// Format phone number cleanly (08...) for pasting directly into WhatsApp contact/chat search
export function formatPhoneForWaSearch(rawPhone?: string, cleanPhone?: string): string {
  const digits = (cleanPhone || cleanPhoneNumber(rawPhone || '')).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('628')) {
    return '0' + digits.slice(2);
  }
  return digits;
}

function fallbackExecCopy(text: string): boolean {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

// Copy text to clipboard immediately inside a click gesture (returning promise without forcing await before navigator.share)
export function copyTextToClipboardSyncOrAsync(text: string): Promise<boolean> {
  if (!text) return Promise.resolve(false);
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackExecCopy(text));
  }
  return Promise.resolve(fallbackExecCopy(text));
}

// Validate if a phone number is a valid registered WhatsApp mobile number format
export function isValidWhatsAppNumber(phone?: string | null): boolean {
  if (!phone || typeof phone !== 'string') return false;
  const trimmed = phone.trim();
  if (!trimmed) return false;

  const cleaned = cleanPhoneNumber(trimmed);

  // Must start with 628 (Indonesian WhatsApp mobile)
  if (!cleaned.startsWith('628')) return false;

  // Length of cleaned 628... number must be 11 to 14 digits (e.g. 628123456789)
  if (cleaned.length < 11 || cleaned.length > 14) return false;

  // Valid operator prefix after 628: 1, 2, 3, 5, 7, 8, 9
  if (!/^628[1235789]/.test(cleaned)) return false;

  // Reject dummy repeating digits (e.g., 628111111111, 628000000000)
  if (/^628(\d)\1{7,}$/.test(cleaned)) return false;

  // Reject dummy sequential numbers (e.g. 628123456789, 628987654321, 6281234567890)
  const subscriber = cleaned.slice(3); // digits after 628
  if (/^(?:12345678|123456789|1234567890|98765432|987654321|9876543210|0123456789|0987654321|00000000|11111111|22222222|33333333|44444444|55555555|66666666|77777777|88888888|99999999)$/.test(subscriber)) {
    return false;
  }

  return true;
}

// Smart detector for auto-routing on manual type
export function detectRouting(text: string): 'modul1' | 'modul2' {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return 'modul1';

  // Address keywords in Indonesian/Local addresses
  const addressKeywords = [
    'jalan', 'jl', 'rt.', 'rw.', 'desa', 'dusun', 'kelurahan', 
    'kecamatan', 'kabupaten', 'gang', 'blok', 'no.', 'mrawun', 
    'seboto', 'rt0', 'rt1', 'rt2', 'rt3', 'rt4', 'rt5', 'rt6', 
    'rt7', 'rt8', 'rt9', 'depan'
  ];

  const containsAddressKeyword = addressKeywords.some(kw => trimmed.includes(kw));
  if (containsAddressKeyword) {
    return 'modul2';
  }

  return 'modul1';
}

// Check if a timestamp corresponds to today's date
export function isToday(timestamp?: number): boolean {
  if (!timestamp) return false;
  const d = new Date(timestamp);
  const today = new Date();
  return d.getDate() === today.getDate() &&
         d.getMonth() === today.getMonth() &&
         d.getFullYear() === today.getFullYear();
}

// Format timestamp for completion dates
export function formatCompletedDate(timestamp?: number): string {
  if (!timestamp) return 'Data Lama';
  const d = new Date(timestamp);
  const dateStr = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr}, ${timeStr}`;
}

// Parse COD string into a numeric integer value
export function parseCodAmount(codStr?: string): number {
  if (!codStr) return 0;
  const upper = codStr.toUpperCase().trim();
  if (upper === 'NO COD' || upper === 'NO_COD' || upper === 'NO' || upper === 'TF' || upper === 'NON COD' || upper === 'LUNAS') {
    return 0;
  }
  const digits = codStr.replace(/[^\d]/g, '');
  if (!digits) return 0;
  return parseInt(digits, 10) || 0;
}

// Format numbers or COD string into IDR currency string
export function formatRupiah(amount: number | string): string {
  const num = typeof amount === 'number' ? amount : parseCodAmount(amount);
  if (num === 0) return 'Rp 0';
  return 'Rp ' + num.toLocaleString('id-ID');
}

// Calculate rounded COD for message template ({COD})
// Rule: < 100 rupiah -> floor to 1000s; >= 100 rupiah -> ceil to 1000s
export function getRoundedCodFormatted(codStr?: string): string {
  const raw = parseCodAmount(codStr);
  if (raw === 0) return 'NO COD';
  
  const remainder = raw % 1000;
  let rounded = raw;
  if (remainder < 100) {
    rounded = Math.floor(raw / 1000) * 1000;
  } else {
    rounded = Math.ceil(raw / 1000) * 1000;
  }
  return formatRupiah(rounded);
}

// Parse explicit package count from customer data
export function getPackageCount(cust?: Partial<Customer> | null): number {
  if (!cust) return 1;

  if (cust.packageCount !== undefined && cust.packageCount !== null) {
    const val = parseInt(String(cust.packageCount), 10);
    if (!isNaN(val) && val > 0) return val;
  }
  if (cust.package_count !== undefined && cust.package_count !== null) {
    const val = parseInt(String(cust.package_count), 10);
    if (!isNaN(val) && val > 0) return val;
  }

  const name = cust.name || '';
  const address = cust.address || '';
  const cod = cust.cod || '';
  const text = `${name} ${address} ${cod}`;

  // 1. Look for explicit parentheses/bracket pattern like (2 paket), (2 pkt), (2), [3 paket], (2paket)
  const bracketMatch = text.match(/[\[\(]\s*(\d+)\s*(?:paket|pkt|pack|pcs)?\s*[\]\)]/i);
  if (bracketMatch) {
    const qty = parseInt(bracketMatch[1], 10);
    if (qty > 0 && qty < 100) return qty;
  }

  // 2. Look for word pattern like "2 paket", "3 pkt", "2-paket"
  const wordMatch = text.match(/\b(\d+)\s*[-]?\s*(?:paket|pkt)\b/i);
  if (wordMatch) {
    const qty = parseInt(wordMatch[1], 10);
    if (qty > 0 && qty < 100) return qty;
  }

  return 1;
}

// Calculate total package sum for a list of customers
export function sumPackageCounts(list: Customer[]): number {
  return list.reduce((sum, cust) => sum + getPackageCount(cust), 0);
}

// Find matching Tempat Titip COD based on customer's address
export function getMatchingTempatCod(customerAddress: string, locations: TempatCodLocation[]): TempatCodLocation | null {
  if (!customerAddress || !locations || !locations.length) return null;
  const lowerAddr = customerAddress.toLowerCase();
  for (const loc of locations) {
    if (!loc.targetAddress) continue;
    const keywords = loc.targetAddress.toLowerCase().split(/[,;\r\n\/]+/).map(k => k.trim()).filter(Boolean);
    for (const kw of keywords) {
      if (kw.length >= 2 && lowerAddr.includes(kw)) {
        return loc;
      }
    }
  }
  return null;
}

// Check if a customer is a duplicate of any existing one in Modul 2
export function isDuplicateInModul2(custToCheck: Partial<Customer>, list: Customer[]): boolean {
  return list.some(c => {
    if (c.status !== 'modul2') return false;
    if (custToCheck.id && c.id === custToCheck.id) return false;

    // Check by cleanPhone
    if (c.cleanPhone && custToCheck.cleanPhone && c.cleanPhone === custToCheck.cleanPhone) {
      return true;
    }

    // Check by name and address (case-insensitive, ignoring whitespace)
    const name1 = (c.name || '').trim().toLowerCase().replace(/\s+/g, '');
    const name2 = (custToCheck.name || '').trim().toLowerCase().replace(/\s+/g, '');
    const addr1 = (c.address || '').trim().toLowerCase().replace(/\s+/g, '');
    const addr2 = (custToCheck.address || '').trim().toLowerCase().replace(/\s+/g, '');

    if (name1 && name1 === name2 && addr1 && addr1 === addr2) {
      return true;
    }

    return false;
  });
}

export const DEFAULT_LOCATIONS: TempatCodLocation[] = [
  { id: '1', name: 'warung mbak tatik', targetAddress: 'sugihwaras, rt 02, guwolelo' },
  { id: '2', name: 'tempat mas yudha', targetAddress: 'mas yudha' },
  { id: '3', name: 'warung kembar sugih waras', targetAddress: 'sugih waras, sugihwaras' },
  { id: '4', name: 'toko rina grogol', targetAddress: 'grogol, pasar grogol' }
];

export const DEFAULT_COD_TEMPLATE = `Permisi kak {Nama}, saya kurir. Paket COD Anda nominal {COD} sudah kami antar ke lokasi ya. Mohon disiapkan uang pas, terima kasih.`;
export const DEFAULT_NOCOD_TEMPLATE = `Permisi kak {Nama}, saya kurir. Paket Non-COD Anda sudah kami antar ke lokasi ya. Terima kasih.`;
export const DEFAULT_TITIP_TEMPLATE = `Permisi kak {Nama}, paket Anda kami titipkan di {tempat cod} dengan nominal {COD} ya. Mohon dapat diambil, terima kasih.`;
export const DEFAULT_AUTO_COD_ONLY_TEMPLATE = `Permisi kak {Nama}, hari ini ada paket COD nominal {COD} ya. Mohon disiapkan uang pas, terima kasih.`;

export function buildHoldCameraTemplateText(
  customerName: string,
  isTitip: boolean,
  titipLocation?: string
): string {
  const safeName = (customerName || 'Kak').trim();
  if (isTitip) {
    const safeLoc = (titipLocation || 'tempat titip').trim();
    return `halo kak ${safeName}, paket sudah saya titipkan di ${safeLoc} ya, harap konfirmasi jika paket sudah di ambil, terimakasih.`;
  }
  return `permisi kak ${safeName}. paket sudah saya kirim ya. harap melakukan pembayaran transfer melalui bca a/n Muhammad nur amin / 1430342645 / dana 085647245365. harap melakukan pembayaran segera ya. terimakasih.`;
}

export function buildHoldOhReturnTemplateText(
  _customer: Pick<Customer, 'name' | 'phone' | 'address'>,
  type: 'oh' | 'return'
): string {
  return type === 'oh' ? 'oh' : 'return';
}

export interface ParsedCustomerInput {
  name: string;
  phone: string;
  cleanPhone: string;
  address: string;
  cod: string;
}

export function parseCustomerInputText(rawText: string): ParsedCustomerInput[] {
  if (!rawText.trim()) return [];

  // 1. Split into blocks by double newlines or horizontal dividers
  let blocks = rawText
    .split(/(?:\r?\n){2,}|(?:\r?\n)[-=_*]{3,}(?:\r?\n)/)
    .map(b => b.trim())
    .filter(Boolean);

  // If splitting by double newlines resulted in only 1 block, check if there are numbered prefixes like 1. 2. or multiple phone numbers
  if (blocks.length === 1) {
    const text = blocks[0];
    const numberedSplit = text.split(/(?:\r?\n)(?=\d+[\.\)]|\[\d+\])/);
    if (numberedSplit.length > 1) {
      blocks = numberedSplit.map(b => b.trim()).filter(Boolean);
    } else {
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const phoneCount = lines.filter(l => /(?:08|\+?628|628)[\d\-\s]{6,14}/.test(l)).length;
      if (phoneCount > 1 && phoneCount === lines.length) {
        blocks = lines;
      }
    }
  }

  const results: ParsedCustomerInput[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    let name = '';
    let rawPhone = '';
    let address = '';
    let cod = 'NO COD';

    const remainingLines: string[] = [];

    for (let line of lines) {
      const cleanLine = line.replace(/^(?:\d+[\.\)]|\[\d+\])\s*/, '').trim();
      if (!cleanLine) continue;

      // 1. Check for explicit Name key
      if (/^(?:nama\s*penerima|nama|penerima|a\.n|an)\s*[:=-]/i.test(cleanLine)) {
        name = cleanLine.replace(/^(?:nama\s*penerima|nama|penerima|a\.n|an)\s*[:=-]\s*/i, '').trim();
        continue;
      }

      // 2. Check for explicit Phone key
      if (/^(?:no\.?\s*hp|nohp|no\.?\s*wa|nowa|telepon|hp|wa)\s*[:=-]/i.test(cleanLine)) {
        rawPhone = cleanLine.replace(/^(?:no\.?\s*hp|nohp|no\.?\s*wa|nowa|telepon|hp|wa)\s*[:=-]\s*/i, '').trim();
        continue;
      }

      // 3. Check for explicit Address key
      if (/^(?:alamat\s*lengkap|alamat|lokasi)\s*[:=-]/i.test(cleanLine)) {
        address = cleanLine.replace(/^(?:alamat\s*lengkap|alamat|lokasi)\s*[:=-]\s*/i, '').trim();
        continue;
      }

      // 4. Check for explicit COD key
      if (/^(?:total\s*cod|total\s*tagihan|nominal\s*cod|total|cod|tagihan)\s*[:=-]/i.test(cleanLine)) {
        const val = cleanLine.replace(/^(?:total\s*cod|total\s*tagihan|nominal\s*cod|total|cod|tagihan)\s*[:=-]\s*/i, '').trim();
        const codNum = parseCodAmount(val);
        if (codNum > 0) {
          cod = formatRupiah(codNum);
        } else {
          cod = 'NO COD';
        }
        continue;
      }

      // 5. Standalone phone number check in line
      const phoneMatch = cleanLine.match(/(?:08|\+?628|628)[\d\-\s]{7,13}/);
      if (phoneMatch && !rawPhone) {
        rawPhone = phoneMatch[0];
        const lineWithoutPhone = cleanLine.replace(phoneMatch[0], '').replace(/^[-|\s,:]+|[-|\s,:]+$/g, '').trim();
        if (lineWithoutPhone) {
          remainingLines.push(lineWithoutPhone);
        }
        continue;
      }

      // 6. In-line COD check
      if (/\b(?:cod|rp\.?|total)\b/i.test(cleanLine) && /\d/.test(cleanLine)) {
        const codNum = parseCodAmount(cleanLine);
        if (codNum > 0 && cod === 'NO COD') {
          cod = formatRupiah(codNum);
          if (/^(?:cod|rp\.?|total|nominal|tagihan|\d|\.|\,|-|\s)+$/i.test(cleanLine)) {
            continue;
          }
        }
      }

      remainingLines.push(cleanLine);
    }

    if (remainingLines.length > 0) {
      if (!name) {
        name = remainingLines.shift() || '';
      }
      if (!address && remainingLines.length > 0) {
        address = remainingLines.join(', ');
      } else if (remainingLines.length > 0) {
        address = address ? `${address}, ${remainingLines.join(', ')}` : remainingLines.join(', ');
      }
    }

    if (!name && rawPhone) {
      name = rawPhone;
    } else if (!name && address) {
      name = 'Pelanggan';
    } else if (!name) {
      name = 'Pelanggan Baru';
    }

    if (!address) {
      address = 'Input Manual';
    }

    const cleanPhone = rawPhone ? cleanPhoneNumber(rawPhone) : '';

    results.push({
      name: cleanPureName(name),
      phone: rawPhone,
      cleanPhone: cleanPhone && cleanPhone.length >= 10 ? cleanPhone : '',
      address: cleanAddressText(address) || 'Input Manual',
      cod
    });
  }

  return results;
}

