export interface Customer {
  id: string;
  originalIndex: number; // Order number (e.g. 1, 2, 3...)
  name: string;
  phone: string;
  cleanPhone: string;
  address: string;
  cod: string; // "NO COD" or numerical value string
  status: 'modul1' | 'modul2' | 'modul3';
  packageCount?: number | string;
  package_count?: number | string;
  paymentType?: 'COD' | 'TF'; // payment method selection
  photos?: string[];
  sendingPhotos?: string[];
  holdPhotos?: string[];
  photoUrl?: string;
  proofPhoto?: string;
  locationUrl?: string; // Google Maps link saved when capturing photo in sending module
  locationTimestamp?: number;
  timestamp: number;
  completedAt?: number; // timestamp when marked completed in Modul 2
  waTemplateSent?: boolean; // track if WhatsApp template has been opened once
  waLastTemplateType?: 'titip' | 'cod' | 'nocod'; // track whether user previously chose titip template
  titipLocationName?: string; // drop-off location name if titip template was chosen
  fillingBatchId?: string; // identifies the Filling session batch for preserving original order on partial sends
  fillingOrder?: number; // original order index inside the Filling batch
}

export interface AppState {
  customers: Customer[];
  rawInput: string;
  searchQuery: string;
}

export interface BulkItem {
  id: string;
  order: number;
  image_url: string;
  name?: string;
  phone?: string;
  address?: string;
  cod_amount?: string;
  package_count?: string | number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  error_message?: string;
  is_reordered?: boolean;
  fillingBatchId?: string;
}

export interface TempatCodLocation {
  id: string;
  name: string;          // Nama Tempat Titip COD (misal: "warung mbak tatik")
  targetAddress: string; // Alamat / Kata Kunci Alamat Terkait (misal: "Sugihwaras, RT 02")
}

export type WaConnectionStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected';

export interface WaGatewayState {
  status: WaConnectionStatus;
  qrDataUrl: string | null;
  pairingCode: string | null;
  user: { id: string; name?: string; phone: string } | null;
  knownChatsCount: number;
  hasSession: boolean;
  lastError: string | null;
}

export type WaAutoSendItemStatus =
  | 'pending'
  | 'waiting_delay'
  | 'sending'
  | 'paused'
  | 'sent_full'
  | 'sent_cod_only'
  | 'skipped_chatted'
  | 'invalid_phone'
  | 'unregistered'
  | 'failed'
  | 'cancelled';

export interface WaAutoSendItemResult {
  customerId: string;
  name: string;
  phone: string;
  status: WaAutoSendItemStatus;
  reason?: string;
  templateType?: 'titip' | 'cod' | 'nocod' | 'cod_only';
  sentAt?: number;
}

export interface WaAutoSendState {
  running: boolean;
  phase: 'idle' | 'checking' | 'waiting_delay' | 'sending' | 'paused' | 'completed' | 'stopped';
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
  items: Record<string, WaAutoSendItemResult>;
}

export interface HoldGroupResolvedItem {
  id: string;
  label: string;
  inviteCode: string;
  url: string;
  subject?: string | null;
  jid?: string | null;
  resolved: boolean;
}

