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
}

export interface TempatCodLocation {
  id: string;
  name: string;          // Nama Tempat Titip COD (misal: "warung mbak tatik")
  targetAddress: string; // Alamat / Kata Kunci Alamat Terkait (misal: "Sugihwaras, RT 02")
}
