import React, { useState, useEffect, useRef } from 'react';
import { db, doc, setDoc, getDoc } from './lib/firebase';
import { 
  Trash2, 
  Sparkles, 
  Send, 
  Smartphone,
  CheckCircle,
  Clock,
  Settings,
  RefreshCw,
  Check,
  Cloud,
  Archive,
  Calendar,
  MessageCircle,
  RotateCcw,
  PhoneOff,
  Play,
  Pause,
  Wifi,
  WifiOff,
  QrCode,
  X,
  SkipForward
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Customer, TempatCodLocation, BulkItem, WaGatewayState, WaAutoSendState, WaPrecheckState, HoldGroupResolvedItem, CustomerChatHistoryInfo } from './types';
import { BulkProcessorView } from './components/BulkProcessorView';
import { CustomerCard } from './components/CustomerCard';
import { SuccessView } from './components/views/SuccessView';
import { InputDock } from './components/InputDock';
import { FloatingPhotoBar } from './components/FloatingPhotoBar';

import { WASheetModal } from './components/modals/WASheetModal';
import { LiveCameraModal, SendingCameraSendResult, HoldCameraSendResult } from './components/modals/LiveCameraModal';
import { PhotoLightboxModal } from './components/modals/PhotoLightboxModal';
import { DropOffLocationModal } from './components/modals/DropOffLocationModal';
import { DayChangeHoldModal } from './components/modals/DayChangeHoldModal';
import { ArchiveModal } from './components/modals/ArchiveModal';
import { ResetSuccessModal } from './components/modals/ResetSuccessModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { WAAutoConnectModal } from './components/modals/WAAutoConnectModal';

import {
  cleanPhoneNumber,
  isValidWhatsAppNumber,
  detectRouting,
  isToday,
  formatRupiah,
  getRoundedCodFormatted,
  parseCodAmount,
  getPackageCount,
  sumPackageCounts,
  isDuplicateInModul2,
  getMatchingTempatCod,
  parseCustomerInputText,
  safeSetLocalStorage,
  safeGetLocalStorage,
  isIncompleteCustomer,
  prepareFirestorePayload,
  stripCompletedBulkImages,
  compressImageDataUrl,
  deduplicateById,
  buildHoldCameraTemplateText,
  buildHoldOhReturnTemplateText,
  DEFAULT_LOCATIONS,
  DEFAULT_COD_TEMPLATE,
  DEFAULT_NOCOD_TEMPLATE,
  DEFAULT_TITIP_TEMPLATE,
  DEFAULT_AUTO_COD_ONLY_TEMPLATE
} from './utils/helpers';
import { buildVariedTemplateMessage } from './utils/templateVariation';
import { HOLD_ON_HOLD_GROUP_OPTIONS } from './utils/holdGroups';

export default function App() {
  // State variables with local storage persistence
  const [customers, setCustomers] = useState<Customer[]>(() => {
    try {
      const saved = localStorage.getItem('kurir_parser_customers');
      return saved ? deduplicateById(JSON.parse(saved)) : [];
    } catch {
      return [];
    }
  });

  const [bulkItems, setBulkItems] = useState<BulkItem[]>(() => {
    try {
      const saved = localStorage.getItem('kurir_parser_bulk_items');
      return saved ? stripCompletedBulkImages(deduplicateById(JSON.parse(saved))) : [];
    } catch {
      return [];
    }
  });

  const [activeTab, setActiveTab] = useState<'filling' | 'modul1' | 'modul2' | 'modul3'>('modul1');
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  
  // WhatsApp message templates
  const [msgTemplateCod, setMsgTemplateCod] = useState<string>(() => {
    return localStorage.getItem('kurir_parser_msg_template_cod') || DEFAULT_COD_TEMPLATE;
  });
  const [msgTemplateNoCod, setMsgTemplateNoCod] = useState<string>(() => {
    return localStorage.getItem('kurir_parser_msg_template_nocod') || DEFAULT_NOCOD_TEMPLATE;
  });
  const [msgTemplateTitip, setMsgTemplateTitip] = useState<string>(() => {
    return localStorage.getItem('kurir_parser_msg_template_titip') || DEFAULT_TITIP_TEMPLATE;
  });
  const [msgTemplateAutoCodOnly, setMsgTemplateAutoCodOnly] = useState<string>(() => {
    return localStorage.getItem('kurir_parser_msg_template_auto_cod_only') || DEFAULT_AUTO_COD_ONLY_TEMPLATE;
  });
  const [waReportNumber, setWaReportNumber] = useState<string>(() => {
    return localStorage.getItem('kurir_parser_wa_report_number') || '';
  });

  // Tempat COD Locations list
  const [tempatCodList, setTempatCodList] = useState<TempatCodLocation[]>(() => {
    try {
      const saved = localStorage.getItem('kurir_parser_tempat_cod_list');
      return saved ? JSON.parse(saved) : DEFAULT_LOCATIONS;
    } catch {
      return DEFAULT_LOCATIONS;
    }
  });

  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationAddress, setNewLocationAddress] = useState('');

  // Editing COD states
  const [editingCodId, setEditingCodId] = useState<string | null>(null);
  const [editingCodText, setEditingCodText] = useState<string>('');

  // Selected photos for multi-select photo sharing in Hold tab
  const [selectedPhotos, setSelectedPhotos] = useState<{ id: string; url: string; customerName: string; phone: string; cleanPhone?: string; index: number }[]>([]);
  const [showWASheet, setShowWASheet] = useState(false);

  // Modals & overlay states
  const [showSettingsInsidePhone, setShowSettingsInsidePhone] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [dropOffModalCustomer, setDropOffModalCustomer] = useState<Customer | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const [showWaConnectModal, setShowWaConnectModal] = useState(false);

  // WhatsApp Baileys Gateway & Sending Auto-Send states
  const [waGateway, setWaGateway] = useState<WaGatewayState>({
    status: 'disconnected',
    qrDataUrl: null,
    pairingCode: null,
    user: null,
    knownChatsCount: 0,
    lockedAnchorsCount: 0,
    maxAnchorsLimit: 6000,
    hasSession: false,
    lastError: null,
  });
  const [waAutoSend, setWaAutoSend] = useState<WaAutoSendState>({
    running: false,
    phase: 'idle',
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
  });
  const [showAutoSendBanner, setShowAutoSendBanner] = useState(false);
  const [autoSendCountdownSec, setAutoSendCountdownSec] = useState(0);
  const waitingWaFillingAutoIdsRef = useRef<Set<string>>(new Set());
  const [waitingWaFillingAutoCount, setWaitingWaFillingAutoCount] = useState(0);
  const [waPrecheck, setWaPrecheck] = useState<WaPrecheckState>({
    running: false,
    total: 0,
    completed: 0,
    currentCustomerId: null,
    currentCustomerName: null,
    currentCustomerPhone: null,
    checkedPhones: [],
    startedAt: null,
    finishedAt: null,
  });
  const [dailySentPhones, setDailySentPhones] = useState<Set<string>>(() => new Set());
  const precheckedCustomerIdsRef = useRef<Set<string>>(new Set());
  const [customerChatHistoryMap, setCustomerChatHistoryMap] = useState<Record<string, CustomerChatHistoryInfo>>({});
  const [checkingWaCustomerId, setCheckingWaCustomerId] = useState<string | null>(null);
  const [holdGroups, setHoldGroups] = useState<HoldGroupResolvedItem[]>(() =>
    HOLD_ON_HOLD_GROUP_OPTIONS.map((g) => ({
      ...g,
      subject: null,
      jid: null,
      resolved: false,
    }))
  );
  const [selectedHoldGroupUrl, setSelectedHoldGroupUrl] = useState<string>(() => {
    const saved = localStorage.getItem('kurir_parser_hold_group_url');
    if (saved && HOLD_ON_HOLD_GROUP_OPTIONS.some((g) => g.url === saved)) {
      return saved;
    }
    return HOLD_ON_HOLD_GROUP_OPTIONS[0].url;
  });

  const handleSelectHoldGroupUrl = (url: string) => {
    setSelectedHoldGroupUrl(url);
    safeSetLocalStorage('kurir_parser_hold_group_url', url);
  };

  // WhatsApp invalid / not registered alert modal state
  const [waErrorModal, setWaErrorModal] = useState<{ show: boolean; customerName: string; phone: string } | null>(null);

  const triggerWaNotRegisteredAlert = (customerName: string, rawPhone: string) => {
    setWaErrorModal({
      show: true,
      customerName: customerName || 'Pelanggan',
      phone: rawPhone || '(Kosong)'
    });
  };

  // Camera states for Modul 3 (Hold - temporary on card) & Modul 1 (Sending - ephemeral WA session only)
  const [cameraActiveForId, setCameraActiveForId] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const [sendingSessionPhotos, setSendingSessionPhotos] = useState<string[]>([]);
  const [sendingSessionLocationUrl, setSendingSessionLocationUrl] = useState<string | null>(null);
  const [isFetchingSendingGps, setIsFetchingSendingGps] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Day change alert states
  const [showDayChangePopup, setShowDayChangePopup] = useState(false);
  const [holdCountTodayAlert, setHoldCountTodayAlert] = useState(0);

  // Archive states
  const [archivedCustomers, setArchivedCustomers] = useState<Customer[]>(() => {
    return deduplicateById(safeGetLocalStorage('kurir_parser_archived_customers', []));
  });
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  // Auto-save status tracking state ('saved' | 'saving' | 'syncing' | 'error')
  // Note: Auto-save strictly locks local positions immediately (0ms). Cloud sync runs only 1x/day on Reset Hari.
  const [saveStatus, setSaveStatus] = useState<'syncing' | 'saved' | 'saving' | 'error'>('saved');
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);

  // Track explicitly deleted/moved IDs (persisted locally) to prevent any resurrections
  const deletedCustomerIdsRef = useRef<Set<string>>(
    new Set(safeGetLocalStorage<string[]>('kurir_parser_deleted_cust_ids', []))
  );
  const deletedBulkIdsRef = useRef<Set<string>>(
    new Set(safeGetLocalStorage<string[]>('kurir_parser_deleted_bulk_ids', []))
  );

  const markCustomerIdsDeleted = (ids: string[]) => {
    const cleanIds = ids.filter(Boolean);
    if (cleanIds.length === 0) return;
    cleanIds.forEach((id) => deletedCustomerIdsRef.current.add(id));
    const arr = Array.from(deletedCustomerIdsRef.current).slice(-300);
    deletedCustomerIdsRef.current = new Set(arr);
    safeSetLocalStorage('kurir_parser_deleted_cust_ids', JSON.stringify(arr));
  };

  const unmarkCustomerIdDeleted = (id: string) => {
    if (!id || !deletedCustomerIdsRef.current.has(id)) return;
    deletedCustomerIdsRef.current.delete(id);
    safeSetLocalStorage('kurir_parser_deleted_cust_ids', JSON.stringify(Array.from(deletedCustomerIdsRef.current)));
  };

  const markBulkIdsDeleted = (ids: string[]) => {
    const cleanIds = ids.filter(Boolean);
    if (cleanIds.length === 0) return;
    cleanIds.forEach((id) => deletedBulkIdsRef.current.add(id));
    const arr = Array.from(deletedBulkIdsRef.current).slice(-300);
    deletedBulkIdsRef.current = new Set(arr);
    safeSetLocalStorage('kurir_parser_deleted_bulk_ids', JSON.stringify(arr));
  };

  const setBulkItemsWithLock: React.Dispatch<React.SetStateAction<BulkItem[]>> = (updater) => {
    setBulkItems((prev) => {
      const nextRaw = typeof updater === 'function' ? updater(prev) : updater;
      const next = stripCompletedBulkImages(nextRaw);
      const nextIds = new Set(next.map((b) => b.id));
      const removedIds = prev.filter((b) => !nextIds.has(b.id)).map((b) => b.id);
      if (removedIds.length > 0) {
        markBulkIdsDeleted(removedIds);
      }
      return next;
    });
  };

  const isDailySyncInFlightRef = useRef<boolean>(false);

  const latestPayloadRef = useRef({
    customers,
    bulkItems,
    msgTemplateCod,
    msgTemplateNoCod,
    msgTemplateTitip,
    tempatCodList,
    waReportNumber
  });
  latestPayloadRef.current = {
    customers,
    bulkItems,
    msgTemplateCod,
    msgTemplateNoCod,
    msgTemplateTitip,
    tempatCodList,
    waReportNumber
  };

  const latestArchivedRef = useRef<Customer[]>(archivedCustomers);
  latestArchivedRef.current = archivedCustomers;

  // Auto-Save Effect: Purely local position persistence (1-by-1 edits/swipes & bulk).
  // Completely decoupled from Cloud Sync so positions stay locked locally without continuous cloud calls.
  useEffect(() => {
    const cleanBulkItems = stripCompletedBulkImages(bulkItems);

    safeSetLocalStorage('kurir_parser_customers', JSON.stringify(customers));
    safeSetLocalStorage('kurir_parser_bulk_items', JSON.stringify(cleanBulkItems));
    safeSetLocalStorage('kurir_parser_msg_template_cod', msgTemplateCod);
    safeSetLocalStorage('kurir_parser_msg_template_nocod', msgTemplateNoCod);
    safeSetLocalStorage('kurir_parser_msg_template_titip', msgTemplateTitip);
    safeSetLocalStorage('kurir_parser_msg_template_auto_cod_only', msgTemplateAutoCodOnly);
    safeSetLocalStorage('kurir_parser_tempat_cod_list', JSON.stringify(tempatCodList));
    safeSetLocalStorage('kurir_parser_wa_report_number', waReportNumber);

    if (!isDailySyncInFlightRef.current) {
      setSaveStatus('saved');
    }
  }, [customers, bulkItems, msgTemplateCod, msgTemplateNoCod, msgTemplateTitip, msgTemplateAutoCodOnly, tempatCodList, waReportNumber]);

  // Persist archive changes locally as well
  useEffect(() => {
    safeSetLocalStorage('kurir_parser_archived_customers', JSON.stringify(archivedCustomers));
  }, [archivedCustomers]);

  // Once-Per-Day Local & Cloud Sync: Triggered ONLY during Day Reset (1x per calendar day)
  const runDailySyncOncePerDay = async (
    triggerReason: 'manual_reset' | 'day_change',
    overrideCustomers?: Customer[]
  ) => {
    const todayStr = new Date().toDateString();
    const lastDailySyncDate = localStorage.getItem('kurir_parser_last_daily_sync_date');

    // Strictly allow synchronization only 1 time per day on Reset Hari
    if (lastDailySyncDate === todayStr || isDailySyncInFlightRef.current) {
      return;
    }

    isDailySyncInFlightRef.current = true;
    safeSetLocalStorage('kurir_parser_last_daily_sync_date', todayStr);
    setSaveStatus('syncing');

    try {
      const currentPayload = latestPayloadRef.current;
      const activeCustomers = overrideCustomers ?? currentPayload.customers;
      const cleanBulk = stripCompletedBulkImages(currentPayload.bulkItems);
      const localArchived = latestArchivedRef.current;

      // 1. Push daily locked state to Firestore app_data/global
      const docRef = doc(db, 'app_data', 'global');
      const firestoreData = prepareFirestorePayload({
        customers: activeCustomers,
        bulkItems: cleanBulk,
        msgTemplateCod: currentPayload.msgTemplateCod,
        msgTemplateNoCod: currentPayload.msgTemplateNoCod,
        msgTemplateTitip: currentPayload.msgTemplateTitip,
        tempatCodList: currentPayload.tempatCodList,
        waReportNumber: currentPayload.waReportNumber,
        lastDailySyncAt: new Date().toISOString(),
        dailySyncReason: triggerReason,
        updatedAt: new Date().toISOString()
      });
      await setDoc(docRef, firestoreData, { merge: true });

      // 2. Sync archived_customers once per day (merge missing remote archive items, then push)
      const archiveDocRef = doc(db, 'app_data', 'archived_customers');
      let mergedArchived = localArchived;
      try {
        const remoteArchSnap = await getDoc(archiveDocRef);
        if (remoteArchSnap.exists()) {
          const remoteItems = deduplicateById((remoteArchSnap.data().items as Customer[]) || []);
          const localIds = new Set(localArchived.map(a => a.id));
          const missingRemote = remoteItems.filter(r => !localIds.has(r.id));
          if (missingRemote.length > 0) {
            mergedArchived = deduplicateById([...localArchived, ...missingRemote]);
            setArchivedCustomers(mergedArchived);
            safeSetLocalStorage('kurir_parser_archived_customers', JSON.stringify(mergedArchived));
          }
        }
      } catch {
        // Ignore read failure; keep local archive safely
      }

      await setDoc(archiveDocRef, prepareFirestorePayload({
        items: mergedArchived,
        lastArchivedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }), { merge: true });

      setIsQuotaExceeded(false);
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const isQuota = errMsg.includes('resource-exhausted') || errMsg.includes('Quota limit exceeded') || err?.code === 'resource-exhausted';
      if (isQuota) {
        setIsQuotaExceeded(true);
      }
      console.warn('Daily reset cloud sync warning (local auto-save data remains intact):', errMsg);
    } finally {
      isDailySyncInFlightRef.current = false;
      setSaveStatus('saved');
    }
  };

  // Run Auto-Archive (>3 days completed) locally
  const handleRunAutoArchiveNow = async () => {
    setIsArchiving(true);
    try {
      const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
      const now = Date.now();

      const itemsToArchive = customers.filter((c) => {
        if (c.status !== 'modul2') return false;
        const compTime = c.completedAt || c.timestamp || 0;
        return (now - compTime) > THREE_DAYS_MS;
      });

      if (itemsToArchive.length === 0) {
        const totalCompleted = customers.filter(c => c.status === 'modul2').length;
        if (totalCompleted > 0) {
          alert(`Terdapat ${totalCompleted} paket selesai (baru/hari ini), namun belum ada yang berusia >3 hari.`);
        } else {
          alert('Tidak ada paket selesai yang perlu diarsip saat ini.');
        }
        setIsArchiving(false);
        return;
      }

      const sanitizeForArchive = (items: Customer[]) => items.map(c => {
        const copy = { ...c };
        delete copy.photoUrl;
        delete copy.proofPhoto;
        delete copy.photos;
        delete copy.sendingPhotos;
        delete copy.holdPhotos;
        return copy;
      });

      const updatedArchived = deduplicateById([...sanitizeForArchive(itemsToArchive), ...archivedCustomers]);
      const updatedCustomers = customers.filter((c) => !itemsToArchive.some((a) => a.id === c.id));
      markCustomerIdsDeleted(itemsToArchive.map((a) => a.id));

      setArchivedCustomers(updatedArchived);
      setCustomers(updatedCustomers);

      safeSetLocalStorage('kurir_parser_archived_customers', JSON.stringify(updatedArchived));

      alert(`Berhasil memindahkan ${itemsToArchive.length} paket selesai (>3 hari) ke Arsip Data!`);
    } catch (err: any) {
      console.error('Auto archive error:', err);
      alert('Gagal memproses arsip: ' + (err?.message || String(err)));
    } finally {
      setIsArchiving(false);
    }
  };

  // Archive ALL completed packages immediately (saved locally; synced 1x/day on Reset Hari)
  const handleArchiveAllSuccessData = async () => {
    const completedItems = customers.filter((c) => c.status === 'modul2');
    if (completedItems.length === 0) {
      alert('Tidak ada paket selesai untuk dipindahkan ke Arsip.');
      return;
    }

    const sanitizeForArchive = (items: Customer[]) => items.map(c => {
      const copy = { ...c };
      delete copy.photoUrl;
      delete copy.proofPhoto;
      delete copy.photos;
      delete copy.sendingPhotos;
      delete copy.holdPhotos;
      return copy;
    });

    const updatedArchived = deduplicateById([...sanitizeForArchive(completedItems), ...archivedCustomers]);
    const updatedCustomers = customers.filter((c) => c.status !== 'modul2');
    markCustomerIdsDeleted(completedItems.map((c) => c.id));

    setArchivedCustomers(updatedArchived);
    setCustomers(updatedCustomers);

    safeSetLocalStorage('kurir_parser_archived_customers', JSON.stringify(updatedArchived));

    alert(`Berhasil memindahkan ${completedItems.length} paket selesai ke Arsip Data!`);
  };

  // Automatic local archive check when customers data updates
  useEffect(() => {
    if (customers.length > 0) {
      const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const hasOldCompleted = customers.some(
        c => c.status === 'modul2' && (now - (c.completedAt || c.timestamp || 0)) > THREE_DAYS_MS
      );
      if (hasOldCompleted) {
        handleRunAutoArchiveNow();
      }
    }
  }, [customers]);

  // Pull back archived customer to active list (locked locally by Auto Save)
  const pullBackCustomer = (cust: Customer) => {
    const restoredCustomer: Customer = {
      ...cust,
      status: 'modul1', // Back to Sending / Modul 1
      timestamp: Date.now(),
      completedAt: undefined,
      autoSendProcessed: false,
    };

    unmarkCustomerIdDeleted(cust.id);
    const newCustomers = deduplicateById([restoredCustomer, ...customers]);
    const newArchived = archivedCustomers.filter((c) => c.id !== cust.id);

    setCustomers(newCustomers);
    setArchivedCustomers(newArchived);

    safeSetLocalStorage('kurir_parser_archived_customers', JSON.stringify(newArchived));
  };

  // Day change check effect: runs once-per-day sync ONLY when the calendar day rolls over
  useEffect(() => {
    const checkDayChange = () => {
      const lastCheckDate = localStorage.getItem('kurir_parser_last_check_date');
      const todayStr = new Date().toDateString();

      if (lastCheckDate && lastCheckDate !== todayStr) {
        const holdItemsCount = latestPayloadRef.current.customers.filter(c => c.status === 'modul3').length;
        if (holdItemsCount > 0) {
          setHoldCountTodayAlert(holdItemsCount);
          setShowDayChangePopup(true);
        }
        void runDailySyncOncePerDay('day_change');
      }
      safeSetLocalStorage('kurir_parser_last_check_date', todayStr);
    };

    checkDayChange();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkDayChange();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Handle camera stream setup & ephemeral Sending session reset
  useEffect(() => {
    // Always clear temporary Sending session photos & GPS when closing or switching customer
    setSendingSessionPhotos([]);
    setSendingSessionLocationUrl(null);
    setIsFetchingSendingGps(false);

    if (!cameraActiveForId) {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        setCameraStream(null);
      }
      setCameraError(false);
      return;
    }

    const activeCust = customers.find(c => c.id === cameraActiveForId);
    if (activeCust?.status === 'modul1') {
      void refreshWaGatewayStatus();
      setIsFetchingSendingGps(true);
      fetchCurrentLocationUrl()
        .then(url => {
          if (url) setSendingSessionLocationUrl(url);
        })
        .finally(() => {
          setIsFetchingSendingGps(false);
        });
    } else if (activeCust?.status === 'modul3') {
      void refreshWaGatewayStatus();
      void refreshHoldGroups();
    }

    let isSubscribed = true;
    async function initCamera() {
      try {
        setCameraError(false);
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment' } 
        });
        if (isSubscribed) {
          setCameraStream(stream);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        } else {
          stream.getTracks().forEach(track => track.stop());
        }
      } catch (err) {
        if (isSubscribed) {
          console.warn('Camera access denied or failed in iframe mode:', err);
          setCameraError(true);
        }
      }
    }

    initCamera();

    return () => {
      isSubscribed = false;
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraActiveForId]);

  // Re-attach video stream if element re-mounts
  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  // Location handlers
  const handleAddLocation = () => {
    if (!newLocationName.trim()) return;
    const newLoc: TempatCodLocation = {
      id: Date.now().toString(),
      name: newLocationName.trim(),
      targetAddress: newLocationAddress.trim()
    };
    setTempatCodList(prev => [...prev, newLoc]);
    setNewLocationName('');
    setNewLocationAddress('');
  };

  const handleDeleteLocation = (id: string) => {
    setTempatCodList(prev => prev.filter(l => l.id !== id));
  };

  const handleUpdateLocationAddress = (id: string, targetAddress: string) => {
    setTempatCodList(prev => prev.map(l => l.id === id ? { ...l, targetAddress } : l));
  };

  const handleResetDefaultLocations = () => {
    setTempatCodList(DEFAULT_LOCATIONS);
  };

  // Process manual single/multi customer input
  const smartRoute = 'modul1' as const;

  const handleProcessInput = () => {
    if (!inputText.trim()) return;
    const parsedList = parseCustomerInputText(inputText);
    if (parsedList.length === 0) return;
    const now = Date.now();

    const newCusts: Customer[] = parsedList.map((item, idx) => {
      return {
        id: `cust_${now}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
        name: item.name,
        phone: item.phone,
        cleanPhone: item.cleanPhone,
        address: item.address,
        cod: item.cod,
        status: 'modul1',
        photos: [],
        timestamp: now + idx,
        originalIndex: customers.length + idx + 1
      };
    });

    setCustomers(prev => deduplicateById([...prev, ...newCusts]));
    setInputText('');
    setActiveTab('modul1');
  };

  // Status migration functions
  const moveToModul2 = (id: string) => {
    const target = customers.find(c => c.id === id);
    if (!target) return;

    const targetPhoneDigits = (target.cleanPhone || cleanPhoneNumber(target.phone || '')).replace(/\D/g, '');
    const targetNormName = (target.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

    // Search for existing entries in modul2 matching phone or name
    const existingModul2List = customers.filter(c => {
      if (c.status !== 'modul2' || c.id === id) return false;

      const cPhoneDigits = (c.cleanPhone || cleanPhoneNumber(c.phone || '')).replace(/\D/g, '');
      const cNormName = (c.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

      const isPhoneMatch = targetPhoneDigits.length >= 8 && cPhoneDigits.length >= 8 &&
        (targetPhoneDigits === cPhoneDigits || targetPhoneDigits.includes(cPhoneDigits) || cPhoneDigits.includes(targetPhoneDigits));

      const isNameMatch = targetNormName.length >= 3 && cNormName.length >= 3 &&
        (targetNormName === cNormName || targetNormName.includes(cNormName) || cNormName.includes(targetNormName));

      return isPhoneMatch || isNameMatch;
    });

    if (existingModul2List.length > 0) {
      // Pick the primary existing modul2 entry to bring to the top
      const primaryModul2 = existingModul2List[0];

      // Remove target and any duplicate modul2 entries except primaryModul2
      const idsToRemove = new Set([
        ...existingModul2List.slice(1).map(c => c.id),
        target.id !== primaryModul2.id ? target.id : ''
      ].filter(Boolean));

      markCustomerIdsDeleted(Array.from(idsToRemove));

      setCustomers(prev => {
        const filtered = prev.filter(c => !idsToRemove.has(c.id));
        return filtered.map(c => {
          if (c.id === primaryModul2.id) {
            return {
              ...c,
              status: 'modul2',
              completedAt: Date.now(), // Naik ke urutan atas Selesai
              cod: target.cod || c.cod, // Nominal COD mengikuti data nominal terakhir
              address: (target.address && target.address.length > 2) ? target.address : c.address,
              photos: [],
              sendingPhotos: [],
              holdPhotos: [],
              paymentType: target.paymentType || c.paymentType,
              waTemplateSent: target.waTemplateSent || c.waTemplateSent
            };
          }
          return c;
        });
      });
    } else {
      // No existing record in Modul 2, simply promote target to Modul 2
      setCustomers(prev => prev.map(c => {
        if (c.id !== id) return c;
        return { 
          ...c, 
          status: 'modul2', 
          completedAt: Date.now(),
          photos: [],
          sendingPhotos: [],
          holdPhotos: []
        };
      }));
    }
  };

  const moveToModul3AndCapture = (customer: Customer) => {
    setCustomers(prev => prev.map(c => c.id === customer.id ? { ...c, status: 'modul3', timestamp: Date.now() } : c));
    setCameraActiveForId(customer.id);
  };

  const returnToModul1 = (id: string) => {
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, status: 'modul1', timestamp: Date.now() } : c));
  };

  const deleteCustomer = (id: string) => {
    markCustomerIdsDeleted([id]);
    setCustomers(prev => prev.filter(c => c.id !== id));
  };

  const toggleManualSkipAutoSend = (id: string) => {
    setCustomers(prev =>
      prev.map(c => {
        if (c.id !== id) return c;
        const nextSkip = !c.manualSkipAutoSend;
        return {
          ...c,
          manualSkipAutoSend: nextSkip,
          waTemplateSent: nextSkip ? true : c.waTemplateSent,
        };
      })
    );
  };

  const handleClearAllManualSkips = () => {
    setCustomers(prev =>
      prev.map(c =>
        c.status === 'modul1' && c.manualSkipAutoSend
          ? { ...c, manualSkipAutoSend: false }
          : c
      )
    );
  };

  const toggleCustomerCompletedDate = (id: string) => {
    setCustomers(prev => prev.map(c => {
      if (c.id !== id) return c;
      const currentCompleted = c.completedAt || c.timestamp;
      const wasToday = isToday(currentCompleted);
      const newTime = wasToday ? (Date.now() - 86400000 * 2) : Date.now();
      return {
        ...c,
        cod: wasToday ? '' : c.cod,
        paymentType: wasToday ? undefined : c.paymentType,
        completedAt: newTime
      };
    }));
  };

  const handleSaveCodAmount = (id: string, newCodVal: string) => {
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, cod: newCodVal.trim() || 'NO COD' } : c));
    setEditingCodId(null);
  };

  const updatePaymentType = (id: string, type: 'COD' | 'TF') => {
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, paymentType: type } : c));
  };

  // WhatsApp target app state ('business' | 'regular')
  const [waTargetApp, setWaTargetApp] = useState<'business' | 'regular'>(() => {
    return (localStorage.getItem('kurir_parser_wa_target') as 'business' | 'regular') || 'business';
  });

  const toggleWaTargetApp = () => {
    const next = waTargetApp === 'business' ? 'regular' : 'business';
    setWaTargetApp(next);
    localStorage.setItem('kurir_parser_wa_target', next);
  };

  // WhatsApp template chat launcher (checks shareloc & house photo availability before composing)
  const handleWhatsAppChat = async (
    customer: Customer,
    dropOffLocation?: string,
    isBusinessOverride?: boolean
  ) => {
    const rawPhone = customer.phone || '';
    const phone = customer.cleanPhone || cleanPhoneNumber(rawPhone);

    if (!rawPhone || !isValidWhatsAppNumber(rawPhone) || !isValidWhatsAppNumber(phone)) {
      triggerWaNotRegisteredAlert(customer.name, rawPhone || customer.phone || '');
      return;
    }

    const openWhatsAppConversation = (messageText: string) => {
      const encodedText = messageText ? encodeURIComponent(messageText) : '';
      const useBusiness = isBusinessOverride !== undefined ? isBusinessOverride : waTargetApp === 'business';

      if (useBusiness) {
        const businessUrl = `whatsapp-business://send?phone=${phone}${encodedText ? `&text=${encodedText}` : ''}`;
        const webUrl = `https://api.whatsapp.com/send?phone=${phone}${encodedText ? `&text=${encodedText}` : ''}`;
        try {
          window.location.href = businessUrl;
          setTimeout(() => {
            window.open(webUrl, '_blank');
          }, 600);
        } catch {
          window.open(webUrl, '_blank');
        }
      } else {
        const waUrl = `https://api.whatsapp.com/send?phone=${phone}${encodedText ? `&text=${encodedText}` : ''}`;
        window.open(waUrl, '_blank');
      }
    };

    // Once card is already marked Terkirim (interacted or skipped), never send any template again
    if (!dropOffLocation && customer.waTemplateSent) {
      openWhatsAppConversation('');
      return;
    }

    const cachedHistory = customerChatHistoryMap[phone];
    let hasShareloc = Boolean(cachedHistory?.hasShareloc);
    let hasHousePhoto = Boolean(cachedHistory?.hasHousePhoto);
    const alreadyVerifiedBoth = hasShareloc && hasHousePhoto;

    setCheckingWaCustomerId(customer.id);
    let timeoutId: number | undefined;
    try {
      const controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), 5000);
      const res = await fetch('/api/wa/check-customer-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, deepCheck: !alreadyVerifiedBoth }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        hasShareloc = Boolean(data?.hasShareloc);
        hasHousePhoto = Boolean(data?.hasHousePhoto);
        setCustomerChatHistoryMap((prev) => ({
          ...prev,
          [phone]: {
            phone,
            hasPriorChat: Boolean(data?.hasPriorChat),
            hasShareloc,
            hasHousePhoto,
            hasAllLocationProof: hasShareloc || hasHousePhoto,
            deepChecked: Boolean(data?.deepChecked),
            checkedAt: Date.now(),
          },
        }));
      }
    } catch {
      // Fall back to cachedHistory values if request fails or times out
    } finally {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      setCheckingWaCustomerId((prev) => (prev === customer.id ? null : prev));
    }

    const hasAllProof = hasShareloc || hasHousePhoto;
    let textToSend = '';
    const roundedCod = getRoundedCodFormatted(customer.cod);
    const isNoCod = parseCodAmount(customer.cod) === 0;

    // Check if dropOffLocation was explicitly passed OR auto-matched by customer address
    const autoMatchedLoc = dropOffLocation ? null : getMatchingTempatCod(customer.address, tempatCodList);
    const activeDropOffName = dropOffLocation || autoMatchedLoc?.name;

    if (dropOffLocation) {
      // Explicit Titip drop-off location selected by user
      textToSend = buildVariedTemplateMessage({
        category: 'titip',
        template: msgTemplateTitip,
        customerName: customer.name,
        codFormatted: roundedCod,
        isNoCod,
        titipLocationName: dropOffLocation,
        customerSeed: `${customer.id}|${customer.phone}|${customer.name}`,
        sequenceIndex: customer.originalIndex,
      });

      setCustomers(prev => prev.map(c => c.id === customer.id ? {
        ...c,
        waTemplateSent: true,
        waLastTemplateType: 'titip',
        titipLocationName: dropOffLocation
      } : c));
    } else if (hasAllProof) {
      // Shareloc AND house photo both already exist:
      // - If Non-COD -> open conversation only without adding any template
      // - If COD -> use varied COD-only template (without requesting shareloc)
      if (isNoCod) {
        textToSend = '';
      } else {
        const baseAutoCodTpl =
          (msgTemplateAutoCodOnly || '').trim() || DEFAULT_AUTO_COD_ONLY_TEMPLATE;
        textToSend = buildVariedTemplateMessage({
          category: 'cod_only',
          template: baseAutoCodTpl,
          customerName: customer.name,
          codFormatted: roundedCod,
          isNoCod: false,
          customerSeed: `${customer.id}|${customer.phone}|${customer.name}`,
          sequenceIndex: customer.originalIndex,
        });
      }

      setCustomers(prev => prev.map(c => c.id === customer.id ? {
        ...c,
        waTemplateSent: true,
        waLastTemplateType: isNoCod ? 'nocod' : 'cod',
      } : c));
    } else if (activeDropOffName) {
      // Shareloc and/or house photo not yet complete, matched Tempat Titip COD
      textToSend = buildVariedTemplateMessage({
        category: 'titip',
        template: msgTemplateTitip,
        customerName: customer.name,
        codFormatted: roundedCod,
        isNoCod,
        titipLocationName: activeDropOffName,
        customerSeed: `${customer.id}|${customer.phone}|${customer.name}`,
        sequenceIndex: customer.originalIndex,
      });

      setCustomers(prev => prev.map(c => c.id === customer.id ? {
        ...c,
        waTemplateSent: true,
        waLastTemplateType: 'titip',
        titipLocationName: activeDropOffName
      } : c));
    } else {
      // Shareloc and/or house photo not yet complete -> send full varied template anchored to Settings
      if (isNoCod) {
        textToSend = buildVariedTemplateMessage({
          category: 'nocod',
          template: msgTemplateNoCod,
          customerName: customer.name,
          codFormatted: roundedCod,
          isNoCod: true,
          customerSeed: `${customer.id}|${customer.phone}|${customer.name}`,
          sequenceIndex: customer.originalIndex,
        });
      } else {
        textToSend = buildVariedTemplateMessage({
          category: 'cod',
          template: msgTemplateCod,
          customerName: customer.name,
          codFormatted: roundedCod,
          isNoCod: false,
          customerSeed: `${customer.id}|${customer.phone}|${customer.name}`,
          sequenceIndex: customer.originalIndex,
        });
      }
      setCustomers(prev => prev.map(c => c.id === customer.id ? {
        ...c,
        waTemplateSent: true,
        waLastTemplateType: isNoCod ? 'nocod' : 'cod',
        titipLocationName: undefined
      } : c));
    }

    openWhatsAppConversation(textToSend);
  };

  // Helper to fetch current location Google Maps URL
  const fetchCurrentLocationUrl = (): Promise<string | null> => {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const url = `https://www.google.com/maps?q=${lat},${lng}`;
          resolve(url);
        },
        (err) => {
          console.warn('Geolocation error:', err?.message || err);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    });
  };

  // Handle captured photo:
  // - Modul 1 (Sending): keep strictly in ephemeral session memory (NOT saved permanently)
  // - Modul 3 (Hold): attach temporarily to Hold card until package succeeds
  const handleCapturedPhoto = (photoDataUrl: string) => {
    if (!cameraActiveForId) return;
    const activeId = cameraActiveForId;
    const targetCust = customers.find(c => c.id === activeId);
    if (!targetCust) return;

    if (targetCust.status === 'modul1') {
      compressImageDataUrl(photoDataUrl).then(compressedUrl => {
        setSendingSessionPhotos(prev => (prev.includes(compressedUrl) ? prev : [...prev, compressedUrl]));
      });
      return;
    }

    // Hold module temporary photo storage
    compressImageDataUrl(photoDataUrl).then(compressedUrl => {
      setCustomers(prev => prev.map(c => {
        if (c.id !== activeId) return c;
        const currentPhotos = c.photos || [];
        const currentHold = c.holdPhotos || [];
        if (currentPhotos.includes(compressedUrl)) return c;
        return {
          ...c,
          photos: [...currentPhotos, compressedUrl],
          holdPhotos: Array.from(new Set([...currentHold, compressedUrl]))
        };
      }));
    });
  };

  // Refresh GPS location when capturing in Sending module if not yet obtained
  const refreshSendingGpsIfNeeded = async () => {
    const targetCust = customers.find(c => c.id === cameraActiveForId);
    if (targetCust?.status !== 'modul1') return;
    setIsFetchingSendingGps(true);
    try {
      const url = await fetchCurrentLocationUrl();
      if (url) {
        setSendingSessionLocationUrl(url);
      }
    } finally {
      setIsFetchingSendingGps(false);
    }
  };

  // Camera & Photo functions
  const capturePhoto = async () => {
    if (!videoRef.current || !cameraActiveForId) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      handleCapturedPhoto(dataUrl);
      refreshSendingGpsIfNeeded();
    }
  };

  const handleFallbackPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !cameraActiveForId) return;
    const file = e.target.files[0];
    refreshSendingGpsIfNeeded();

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        handleCapturedPhoto(event.target.result as string);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !cameraActiveForId) return;
    const filesArray: File[] = Array.from(e.target.files);
    refreshSendingGpsIfNeeded();

    filesArray.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          handleCapturedPhoto(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const deleteCustomerPhoto = (customerId: string, photoIndex: number) => {
    const target = customers.find(c => c.id === customerId);
    if (target?.status === 'modul1') {
      setSendingSessionPhotos(prev => prev.filter((_, idx) => idx !== photoIndex));
      return;
    }

    setCustomers(prev => {
      const targetCust = prev.find(c => c.id === customerId);
      if (!targetCust) return prev;
      const photoToRemove = targetCust.photos?.[photoIndex];
      return prev.map(c => {
        if (c.id !== customerId) return c;
        const currentPhotos = c.photos || [];
        const currentHold = c.holdPhotos || [];
        return {
          ...c,
          photos: currentPhotos.filter((_, idx) => idx !== photoIndex),
          holdPhotos: currentHold.filter(p => p !== photoToRemove)
        };
      });
    });

    setSelectedPhotos(prev => prev.filter(item => !(item.id === customerId && item.index === photoIndex)));
  };

  const togglePhotoSelection = (customer: Customer, photoUrl: string, idx: number) => {
    setSelectedPhotos(prev => {
      const exists = prev.some(item => item.id === customer.id && item.index === idx);
      if (exists) {
        return prev.filter(item => !(item.id === customer.id && item.index === idx));
      } else {
        return [...prev, {
          id: customer.id,
          url: photoUrl,
          customerName: customer.name,
          phone: customer.phone,
          cleanPhone: customer.cleanPhone,
          index: idx
        }];
      }
    });
  };

  const handleSendPhotosToWhatsApp = async (isBusiness: boolean = false) => {
    if (selectedPhotos.length === 0) return;
    const targetCust = selectedPhotos[0];
    const rawPhone = targetCust.phone || '';
    const phone = targetCust.cleanPhone || cleanPhoneNumber(rawPhone);

    if (!rawPhone || !isValidWhatsAppNumber(rawPhone) || !isValidWhatsAppNumber(phone)) {
      setShowWASheet(false);
      triggerWaNotRegisteredAlert(targetCust.customerName, rawPhone || targetCust.phone || '');
      return;
    }

    try {
      const lastPhoto = selectedPhotos[selectedPhotos.length - 1];
      const res = await fetch(lastPhoto.url);
      const blob = await res.blob();
      if (typeof window !== 'undefined' && 'ClipboardItem' in window) {
        const ClipboardItemClass = (window as unknown as { ClipboardItem: new (data: Record<string, Blob>) => ClipboardItem }).ClipboardItem;
        await navigator.clipboard.write([
          new ClipboardItemClass({ [blob.type]: blob })
        ]);
      }
    } catch {
      console.warn('Clipboard write failure');
    }

    const custObj = customers.find(c => c.id === targetCust.id);
    const isTitip = custObj?.waLastTemplateType === 'titip' && Boolean(custObj?.titipLocationName);
    const caption = buildHoldCameraTemplateText(targetCust.customerName, isTitip, custObj?.titipLocationName);
    const encodedCaption = encodeURIComponent(caption);

    if (isBusiness) {
      const businessUrl = `whatsapp-business://send?phone=${phone}&text=${encodedCaption}`;
      const webUrl = `https://api.whatsapp.com/send?phone=${phone}&text=${encodedCaption}`;
      try {
        window.location.href = businessUrl;
        setTimeout(() => {
          window.open(webUrl, '_blank');
        }, 600);
      } catch {
        window.open(webUrl, '_blank');
      }
    } else {
      const waUrl = `https://api.whatsapp.com/send?phone=${phone}&text=${encodedCaption}`;
      window.open(waUrl, '_blank');
    }

    setShowWASheet(false);
    setSelectedPhotos([]);
  };

  // Send Hold photo automatically via Baileys in 2 messages:
  // (1) Photo + customer template caption to buyer's registered WhatsApp number
  // (2) Photo + "oh" or "return" caption to the selected On Hold WhatsApp group
  const handleSendHoldCameraBundle = async (
    customer: Customer,
    photoUrl: string,
    templateCaption: string,
    ohReturnType: 'oh' | 'return',
    groupUrl: string
  ): Promise<HoldCameraSendResult> => {
    if (!photoUrl) {
      return { ok: false, method: 'error', error: 'Foto tidak ditemukan.' };
    }

    const rawPhone = customer.phone || '';
    const phone = customer.cleanPhone || cleanPhoneNumber(rawPhone);
    if (!rawPhone || !isValidWhatsAppNumber(rawPhone) || !isValidWhatsAppNumber(phone)) {
      return {
        ok: false,
        method: 'invalid_phone',
        error: `Nomor terdaftar pelanggan (${rawPhone || 'kosong'}) tidak valid untuk WhatsApp.`,
      };
    }

    if (!groupUrl || !HOLD_ON_HOLD_GROUP_OPTIONS.some((g) => g.url === groupUrl)) {
      return {
        ok: false,
        method: 'missing_group',
        error: 'Silakan pilih salah satu grup On Hold tujuan terlebih dahulu.',
      };
    }

    if (waGateway.status !== 'connected') {
      return {
        ok: false,
        method: 'not_connected',
        error: 'WhatsApp belum terhubung. Hubungkan WA terlebih dahulu untuk mengirim 2 pesan otomatis.',
      };
    }

    const finalTemplate = (templateCaption || '').trim();
    if (!finalTemplate) {
      return {
        ok: false,
        method: 'error',
        error: 'Keterangan template pesan pelanggan masih kosong.',
      };
    }

    const ohReturnCaption = buildHoldOhReturnTemplateText(customer, ohReturnType);

    let finalDataUrl = photoUrl;
    if (!finalDataUrl.startsWith('data:image')) {
      try {
        const res = await fetch(photoUrl);
        const blob = await res.blob();
        finalDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Gagal membaca foto'));
          reader.readAsDataURL(blob);
        });
      } catch {
        return { ok: false, method: 'error', error: 'Gagal memproses file foto.' };
      }
    }

    try {
      const res = await fetch('/api/wa/send-hold-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPhone: phone,
          imageDataUrl: finalDataUrl,
          templateCaption: finalTemplate,
          groupInviteUrl: groupUrl,
          ohReturnCaption,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.gateway) {
        setWaGateway(data.gateway);
      }

      if (data?.buyerSent) {
        setCustomers((prev) =>
          prev.map((c) =>
            c.id === customer.id ? { ...c, waTemplateSent: true } : c
          )
        );
      }

      if (!res.ok || !data?.ok) {
        if (data?.notConnected || res.status === 409) {
          return {
            ok: false,
            method: 'not_connected',
            buyerSent: false,
            groupSent: false,
            error: data?.error || 'WhatsApp belum terhubung.',
          };
        }
        if (data?.partialError || data?.buyerSent) {
          return {
            ok: false,
            method: 'partial_error',
            buyerSent: Boolean(data?.buyerSent),
            groupSent: Boolean(data?.groupSent),
            sentToPhone: data?.targetPhone || phone,
            groupLabel: data?.groupSubject,
            error: data?.error || 'Pesan ke pelanggan terkirim, namun gagal mengirim ke grup On Hold.',
          };
        }
        return {
          ok: false,
          method: 'error',
          buyerSent: false,
          groupSent: false,
          error: data?.error || 'Gagal mengirim 2 pesan otomatis.',
        };
      }

      void refreshHoldGroups();

      return {
        ok: true,
        method: 'baileys_dual',
        buyerSent: true,
        groupSent: true,
        sentToPhone: data.targetPhone || phone,
        groupLabel: data.groupSubject,
      };
    } catch (err: any) {
      return {
        ok: false,
        method: 'error',
        error: err?.message || 'Gagal terhubung ke server pengirim WhatsApp.',
      };
    }
  };

  const handleSendCameraToWaBusiness = async (
    customer: Customer,
    photoUrl: string,
    gpsUrl?: string | null
  ): Promise<SendingCameraSendResult> => {
    if (!photoUrl) {
      return { ok: false, method: 'error', error: 'Foto tidak ditemukan.' };
    }

    const cleanedTarget = waReportNumber.trim() ? cleanPhoneNumber(waReportNumber.trim()) : '';
    if (!cleanedTarget || cleanedTarget.length < 9) {
      return {
        ok: false,
        method: 'missing_target',
        error: 'Nomor tujuan WhatsApp belum diatur atau tidak valid.',
      };
    }

    if (waGateway.status !== 'connected') {
      return {
        ok: false,
        method: 'not_connected',
        error: 'WhatsApp belum terhubung. Hubungkan WA terlebih dahulu.',
      };
    }

    let finalGpsUrl = gpsUrl || sendingSessionLocationUrl;
    if (!finalGpsUrl) {
      setIsFetchingSendingGps(true);
      try {
        finalGpsUrl = await fetchCurrentLocationUrl();
        if (finalGpsUrl) {
          setSendingSessionLocationUrl(finalGpsUrl);
        }
      } finally {
        setIsFetchingSendingGps(false);
      }
    }

    const messageLines = [
      `Nama: ${customer.name}`,
      `Alamat: ${customer.address}`,
      `Lokasi GPS: ${finalGpsUrl ? finalGpsUrl : '(Tidak tersedia - pastikan izin lokasi aktif)'}`
    ];
    const messageText = messageLines.join('\n');

    let finalDataUrl = photoUrl;
    if (!finalDataUrl.startsWith('data:image')) {
      try {
        const res = await fetch(photoUrl);
        const blob = await res.blob();
        finalDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Gagal membaca foto'));
          reader.readAsDataURL(blob);
        });
      } catch {
        return { ok: false, method: 'error', messageText, error: 'Gagal memproses file foto.' };
      }
    }

    try {
      const res = await fetch('/api/wa/send-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPhone: cleanedTarget,
          imageDataUrl: finalDataUrl,
          caption: messageText,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.gateway) {
        setWaGateway(data.gateway);
      }

      if (!res.ok || !data?.ok) {
        if (data?.notConnected || res.status === 409) {
          return {
            ok: false,
            method: 'not_connected',
            messageText,
            error: data?.error || 'WhatsApp belum terhubung.',
          };
        }
        return {
          ok: false,
          method: 'error',
          messageText,
          error: data?.error || 'Gagal mengirim pesan otomatis ke nomor tujuan.',
        };
      }

      return {
        ok: true,
        method: 'baileys_direct',
        messageText,
        sentToPhone: data.targetPhone || cleanedTarget,
      };
    } catch (err: any) {
      return {
        ok: false,
        method: 'error',
        messageText,
        error: err?.message || 'Gagal terhubung ke server pengirim WhatsApp.',
      };
    }
  };

  // Reset modal action handlers
  const handleResetTodayCountToZero = () => {
    let incompleteRemoved = 0;
    const removedIds: string[] = [];

    // 1. Delete all incomplete customer records completely (e.g. missing address or phone, only name & COD)
    const completeOnly = customers.filter(c => {
      if (isIncompleteCustomer(c)) {
        incompleteRemoved++;
        removedIds.push(c.id);
        return false; // Do not include in history or active list
      }
      return true;
    });
    if (removedIds.length > 0) markCustomerIdsDeleted(removedIds);

    // 2. Move remaining complete items from today to past history and clear COD & paymentType
    const nextCustomers = completeOnly.map(c => {
      if (c.status === 'modul2') {
        const isItemToday = isToday(c.completedAt || c.timestamp);
        const holdSet = new Set(c.holdPhotos || []);
        const cleanPhotos = (c.photos || []).filter(p => !holdSet.has(p));
        return {
          ...c,
          cod: '',
          paymentType: undefined,
          completedAt: isItemToday ? Date.now() - 86400000 * 2 : (c.completedAt || c.timestamp),
          photos: cleanPhotos,
          holdPhotos: []
        };
      }
      return c;
    });

    setCustomers(nextCustomers);
    safeSetLocalStorage('kurir_parser_customers', JSON.stringify(nextCustomers));
    setShowResetModal(false);

    // Execute once-per-day local + cloud synchronization on Reset Hari
    void runDailySyncOncePerDay('manual_reset', nextCustomers);

    if (incompleteRemoved > 0) {
      alert(`Reset Hari Berhasil!\n\n• Hitungan hari ini direset ke 0.\n• Nominal COD & Opsi Pembayaran pada modul Success telah dihapus/direset.\n• ${incompleteRemoved} data tidak lengkap telah otomatis dihapus.\n• Sinkronisasi data harian (1x/hari) dijalankan.`);
    } else {
      alert('Reset Hari Berhasil!\n\n• Hitungan hari ini direset ke 0.\n• Nominal COD & Opsi Pembayaran pada modul Success telah dihapus/direset.\n• Sinkronisasi data harian (1x/hari) dijalankan.');
    }
  };

  const handleReturnTodaySuccessToSending = () => {
    let incompleteRemoved = 0;

    setCustomers(prev => {
      const removedIds: string[] = [];
      const completeOnly = prev.filter(c => {
        if (isIncompleteCustomer(c)) {
          incompleteRemoved++;
          removedIds.push(c.id);
          return false;
        }
        return true;
      });
      if (removedIds.length > 0) markCustomerIdsDeleted(removedIds);

      return completeOnly.map(c => {
        if (c.status === 'modul2' && isToday(c.completedAt || c.timestamp)) {
          return {
            ...c,
            status: 'modul1',
            timestamp: Date.now()
          };
        }
        return c;
      });
    });

    setShowResetModal(false);

    if (incompleteRemoved > 0) {
      alert(`Mengembalikan data ke Sending selesai.\n\n${incompleteRemoved} data tidak lengkap telah otomatis dihapus.`);
    }
  };

  const handleClearAllSuccessData = () => {
    if (window.confirm('Hapus permanen semua data di tab Success?')) {
      setCustomers(prev => {
        markCustomerIdsDeleted(prev.filter(c => c.status === 'modul2').map(c => c.id));
        return prev.filter(c => c.status !== 'modul2');
      });
      setShowResetModal(false);
    }
  };

  const loadSampleData = () => {
    const sample: Customer[] = [
      {
        id: '1',
        name: 'Budi Santoso (2 paket)',
        phone: '081234567890',
        cleanPhone: '6281234567890',
        address: 'Jl. Merdeka No. 45, Desa Sugihwaras, RT 02/RW 01, Kecamatan Krajan',
        cod: '50000',
        status: 'modul1',
        timestamp: Date.now(),
        originalIndex: 1
      },
      {
        id: '2',
        name: 'Siti Aminah',
        phone: '089876543210',
        cleanPhone: '6289876543210',
        address: 'Dusun Mrawun RT 05/RW 02, Depan Toko Klontong',
        cod: 'NO COD',
        status: 'modul1',
        timestamp: Date.now(),
        originalIndex: 2
      }
    ];
    setCustomers(sample);
  };

  const clearAllData = () => {
    deletedCustomerIdsRef.current.clear();
    deletedBulkIdsRef.current.clear();
    precheckedCustomerIdsRef.current.clear();
    localStorage.removeItem('kurir_parser_deleted_cust_ids');
    localStorage.removeItem('kurir_parser_deleted_bulk_ids');
    setCustomers([]);
    setBulkItems([]);
    localStorage.removeItem('kurir_parser_customers');
    localStorage.removeItem('kurir_parser_bulk_items');
    void handleResetAutoSendSending();
  };

  // Filtered customer lists
  const filteredCustomers = deduplicateById(
    customers.filter(c => {
      if (c.status !== activeTab) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        c.cod.toLowerCase().includes(q)
      );
    })
  );
  const pendingAutoSendCustomers =
    activeTab === 'modul1' ? filteredCustomers.filter((c) => !c.autoSendProcessed) : [];

  const matchingArchived = deduplicateById(
    searchQuery.trim()
      ? archivedCustomers.filter(c => {
          const q = searchQuery.toLowerCase().trim();
          return (
            c.name.toLowerCase().includes(q) ||
            c.phone.toLowerCase().includes(q) ||
            c.address.toLowerCase().includes(q) ||
            (c.cod && c.cod.toLowerCase().includes(q))
          );
        })
      : []
  );

  const modul1List = deduplicateById(customers.filter(c => c.status === 'modul1'));
  const allSuccessList = deduplicateById(customers.filter(c => c.status === 'modul2'));
  const todaySuccessList = deduplicateById(allSuccessList.filter(c => isToday(c.completedAt || c.timestamp)));
  const modul3List = deduplicateById(customers.filter(c => c.status === 'modul3'));

  // Sum of COD for today's success items (excluding items paid via TF / Transfer)
  const codTodayNominal = todaySuccessList.reduce((acc, curr) => {
    if (curr.paymentType === 'TF') return acc;
    return acc + parseCodAmount(curr.cod);
  }, 0);

  const cameraCustomer = customers.find(c => c.id === cameraActiveForId);

  // --- Baileys WhatsApp Auto-Send Helpers (Sending Module Only) ---
  const syncWaAutoSendUpdatesToCustomers = (nextAutoSend: WaAutoSendState) => {
    const itemsMap = nextAutoSend.items || {};
    const allResults = Object.values(itemsMap);
    if (allResults.length === 0) return;

    const isTerminalStatus = (status: WaAutoSendState['items'][string]['status']) =>
      status === 'sent_full' ||
      status === 'sent_cod_only' ||
      status === 'skipped_chatted' ||
      status === 'skipped_manual' ||
      status === 'skipped_daily_limit' ||
      status === 'invalid_phone' ||
      status === 'unregistered' ||
      status === 'failed';

    const terminalMap = new Map(
      allResults.filter((it) => isTerminalStatus(it.status)).map((it) => [it.customerId, it])
    );

    if (terminalMap.size > 0) {
      setCustomers((prev) => {
        let changed = false;
        const next = prev.map((c) => {
          const res = terminalMap.get(c.id);
          if (!res) return c;

          const shouldMarkSent =
            res.status === 'sent_full' ||
            res.status === 'sent_cod_only' ||
            res.status === 'skipped_chatted' ||
            res.status === 'skipped_daily_limit';

          const needsProcessedFlag = !c.autoSendProcessed;
          const needsSentFlag = shouldMarkSent && !c.waTemplateSent;
          if (!needsProcessedFlag && !needsSentFlag) return c;

          changed = true;
          const mappedType: 'titip' | 'cod' | 'nocod' =
            res.templateType === 'titip'
              ? 'titip'
              : res.templateType === 'nocod'
              ? 'nocod'
              : 'cod';

          return {
            ...c,
            autoSendProcessed: true,
            waTemplateSent: shouldMarkSent ? true : c.waTemplateSent,
            waLastTemplateType:
              res.status === 'sent_full' || res.status === 'sent_cod_only'
                ? mappedType
                : c.waLastTemplateType,
          };
        });
        return changed ? next : prev;
      });
    }
  };

  const applyGatewayPayload = (data: any) => {
    if (!data || typeof data !== 'object') return;
    if (data.gateway) setWaGateway(data.gateway);
    if (data.precheck) setWaPrecheck(data.precheck);
    if (Array.isArray(data.dailySentPhones)) {
      setDailySentPhones(new Set(data.dailySentPhones));
    }
    if (data.autoSend) {
      setWaAutoSend(data.autoSend);
      syncWaAutoSendUpdatesToCustomers(data.autoSend);
      if (data.autoSend.running) {
        setShowAutoSendBanner(true);
      }
    }
  };

  const refreshHoldGroups = async () => {
    try {
      const res = await fetch('/api/wa/hold-groups');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.groups) && data.groups.length > 0) {
        setHoldGroups(data.groups);
      }
    } catch {
      // Ignore transient network errors
    }
  };

  const refreshWaGatewayStatus = async () => {
    try {
      const res = await fetch('/api/wa/status');
      if (!res.ok) return;
      const data = await res.json();
      applyGatewayPayload(data);
    } catch {
      // Ignore transient network errors
    }
  };

  const connectWaGatewayClient = async () => {
    const res = await fetch('/api/wa/connect', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Gagal menghubungkan WhatsApp');
    applyGatewayPayload(data);
  };

  const requestWaPairingCodeClient = async (phone: string): Promise<string | null> => {
    const res = await fetch('/api/wa/pairing-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Gagal meminta kode pairing');
    if (data.gateway) setWaGateway(data.gateway);
    return data.code || null;
  };

  const logoutWaGatewayClient = async () => {
    const res = await fetch('/api/wa/logout', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Gagal memutuskan WhatsApp');
    precheckedCustomerIdsRef.current.clear();
    applyGatewayPayload(data);
  };

  const handleStartAutoSendSending = async () => {
    if (activeTab !== 'modul1') return;

    if (waGateway.status !== 'connected') {
      setShowWaConnectModal(true);
      if (waGateway.status === 'disconnected') {
        void connectWaGatewayClient().catch(() => {});
      }
      return;
    }

    if (filteredCustomers.length === 0 || pendingAutoSendCustomers.length === 0) {
      return;
    }

    if (pendingAutoSendCustomers.every((c) => c.manualSkipAutoSend)) {
      alert('Semua kartu baru di modul Sending ditandai Skip Manual. Matikan minimal 1 Skip Manual untuk memulai kirim otomatis.');
      return;
    }

    try {
      const payloadItems = pendingAutoSendCustomers.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        cleanPhone: c.cleanPhone,
        address: c.address,
        cod: c.cod,
        waTemplateSent: Boolean(c.waTemplateSent),
        titipLocationName: c.titipLocationName,
        manualSkipAutoSend: Boolean(c.manualSkipAutoSend),
      }));

      const res = await fetch('/api/wa/auto-send/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: payloadItems,
          templates: {
            cod: msgTemplateCod,
            nocod: msgTemplateNoCod,
            titip: msgTemplateTitip,
            codOnlyNoShareloc: msgTemplateAutoCodOnly,
          },
          tempatCodList,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Gagal memulai kirim otomatis.');
        return;
      }
      applyGatewayPayload(data);
      setShowAutoSendBanner(true);
    } catch (err: any) {
      alert(err?.message || 'Gagal menghubungi server WhatsApp.');
    }
  };

  const handlePauseAutoSendSending = async () => {
    try {
      const res = await fetch('/api/wa/auto-send/pause', { method: 'POST' });
      const data = await res.json();
      applyGatewayPayload(data);
      if (data.autoSend) {
        setShowAutoSendBanner(true);
      }
    } catch {
      // Ignore pause error
    }
  };

  const handleResumeAutoSendSending = async () => {
    if (activeTab !== 'modul1') return;

    if (waGateway.status !== 'connected') {
      setShowWaConnectModal(true);
      if (waGateway.status === 'disconnected') {
        void connectWaGatewayClient().catch(() => {});
      }
      return;
    }

    try {
      const resumeCandidates = filteredCustomers.filter(
        (c) => !c.autoSendProcessed || Boolean(waAutoSend.items[c.id])
      );
      const payloadItems = resumeCandidates.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        cleanPhone: c.cleanPhone,
        address: c.address,
        cod: c.cod,
        waTemplateSent: Boolean(c.waTemplateSent),
        titipLocationName: c.titipLocationName,
        manualSkipAutoSend: Boolean(c.manualSkipAutoSend),
      }));

      const res = await fetch('/api/wa/auto-send/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: payloadItems,
          templates: {
            cod: msgTemplateCod,
            nocod: msgTemplateNoCod,
            titip: msgTemplateTitip,
            codOnlyNoShareloc: msgTemplateAutoCodOnly,
          },
          tempatCodList,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Gagal melanjutkan kirim otomatis.');
        return;
      }
      applyGatewayPayload(data);
      setShowAutoSendBanner(true);
    } catch (err: any) {
      alert(err?.message || 'Gagal menghubungi server WhatsApp.');
    }
  };

  const handleResetAutoSendSending = async () => {
    try {
      const res = await fetch('/api/wa/auto-send/reset', { method: 'POST' });
      const data = await res.json();
      applyGatewayPayload(data);
      setShowAutoSendBanner(false);
    } catch {
      // Ignore reset error
    }
  };

  const enqueueFillingCustomersToAutoSend = async (targetCustomers: Customer[], initialDelayMs = 60_000) => {
    if (targetCustomers.length === 0) return;

    const payloadItems = targetCustomers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      cleanPhone: c.cleanPhone,
      address: c.address,
      cod: c.cod,
      waTemplateSent: Boolean(c.waTemplateSent),
      titipLocationName: c.titipLocationName,
      manualSkipAutoSend: Boolean(c.manualSkipAutoSend),
    }));

    try {
      const res = await fetch('/api/wa/auto-send/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: payloadItems,
          initialDelayMs,
          templates: {
            cod: msgTemplateCod,
            nocod: msgTemplateNoCod,
            titip: msgTemplateTitip,
            codOnlyNoShareloc: msgTemplateAutoCodOnly,
          },
          tempatCodList,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (waGateway.status !== 'connected') {
          targetCustomers.forEach((c) => waitingWaFillingAutoIdsRef.current.add(c.id));
          setWaitingWaFillingAutoCount(waitingWaFillingAutoIdsRef.current.size);
        }
        return;
      }
      targetCustomers.forEach((c) => waitingWaFillingAutoIdsRef.current.delete(c.id));
      setWaitingWaFillingAutoCount(waitingWaFillingAutoIdsRef.current.size);
      applyGatewayPayload(data);
      setShowAutoSendBanner(true);
    } catch {
      targetCustomers.forEach((c) => waitingWaFillingAutoIdsRef.current.add(c.id));
      setWaitingWaFillingAutoCount(waitingWaFillingAutoIdsRef.current.size);
    }
  };

  const handleAutoTransferBatchToSending = (
    transferredCustomers: Customer[],
    _meta: { isFinalBatch: boolean; remainingCount: number }
  ) => {
    if (transferredCustomers.length === 0) return;
    if (waGateway.status !== 'connected') {
      transferredCustomers.forEach((c) => waitingWaFillingAutoIdsRef.current.add(c.id));
      setWaitingWaFillingAutoCount(waitingWaFillingAutoIdsRef.current.size);
      return;
    }
    void enqueueFillingCustomersToAutoSend(transferredCustomers, 60_000);
  };

  // Initial status fetch when entering Sending or Hold tab
  useEffect(() => {
    if (activeTab === 'modul1') {
      void refreshWaGatewayStatus();
    } else if (activeTab === 'modul3') {
      void refreshWaGatewayStatus();
      void refreshHoldGroups();
    }
  }, [activeTab]);

  // Refresh Hold group names and flush queued Filling Otomatis batches whenever WhatsApp connects
  useEffect(() => {
    if (waGateway.status === 'connected') {
      void refreshHoldGroups();
      if (waitingWaFillingAutoIdsRef.current.size > 0) {
        const queuedIds = new Set(waitingWaFillingAutoIdsRef.current);
        const queuedCustomers = latestPayloadRef.current.customers.filter(
          (c) => c.status === 'modul1' && !c.autoSendProcessed && queuedIds.has(c.id)
        );
        if (queuedCustomers.length > 0) {
          void enqueueFillingCustomersToAutoSend(queuedCustomers, 60_000);
        } else {
          waitingWaFillingAutoIdsRef.current.clear();
          setWaitingWaFillingAutoCount(0);
        }
      }
    }
  }, [waGateway.status]);

  // Auto read-only pre-scan whenever Sending receives new data (e.g. from Filling)
  useEffect(() => {
    if (waGateway.status !== 'connected' || waAutoSend.running) return;

    const newCandidates = customers.filter((c) => {
      if (c.status !== 'modul1') return false;
      if (c.autoSendProcessed) return false;
      if (precheckedCustomerIdsRef.current.has(c.id)) return false;
      const phone = c.cleanPhone || cleanPhoneNumber(c.phone || '');
      return Boolean(phone && isValidWhatsAppNumber(phone));
    });

    if (newCandidates.length === 0) return;

    newCandidates.forEach((c) => precheckedCustomerIdsRef.current.add(c.id));

    const items = newCandidates.slice(0, 200).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.cleanPhone || cleanPhoneNumber(c.phone || ''),
    }));

    void (async () => {
      try {
        const res = await fetch('/api/wa/precheck-customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.gateway) setWaGateway(data.gateway);
        if (data?.precheck) setWaPrecheck(data.precheck);
        if (Array.isArray(data?.dailySentPhones)) {
          setDailySentPhones(new Set(data.dailySentPhones));
        }
        if (data?.results && typeof data.results === 'object') {
          setCustomerChatHistoryMap((prev) => ({
            ...prev,
            ...data.results,
          }));
        }
      } catch {
        // Ignore transient precheck network failures
      }
    })();
  }, [customers, waGateway.status, waAutoSend.running]);

  // Batch check known shareloc & house photo status for active cards
  useEffect(() => {
    const phones = Array.from(
      new Set(
        customers
          .map((c) => c.cleanPhone || cleanPhoneNumber(c.phone || ''))
          .filter((p) => p && isValidWhatsAppNumber(p))
      )
    ).slice(0, 200);

    if (phones.length === 0) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/wa/check-customers-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phones }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data?.results && typeof data.results === 'object' && !cancelled) {
          setCustomerChatHistoryMap((prev) => ({
            ...prev,
            ...data.results,
          }));
        }
        if (Array.isArray(data?.dailySentPhones) && !cancelled) {
          setDailySentPhones(new Set(data.dailySentPhones));
        }
      } catch {
        // Ignore transient batch check errors
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    customers,
    waGateway.status,
    waGateway.knownChatsCount,
    waGateway.knownSharelocCount,
    waGateway.knownHousePhotoCount,
    waPrecheck.completed,
    waPrecheck.running,
  ]);

  // Poll status while QR/pairing modal is open, precheck is scanning, or auto-send queue is active
  useEffect(() => {
    if (!showWaConnectModal && !waAutoSend.running && !waPrecheck.running) return;
    const intervalMs = waPrecheck.running && !waAutoSend.running ? 900 : 1500;
    const timer = window.setInterval(() => {
      void refreshWaGatewayStatus();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [showWaConnectModal, waAutoSend.running, waPrecheck.running]);

  // Live 1-second countdown display for 10-20s anti-ban gap
  useEffect(() => {
    if (!waAutoSend.running || !waAutoSend.nextSendAt) {
      setAutoSendCountdownSec(0);
      return;
    }
    const updateTick = () => {
      const rem = Math.max(0, Math.ceil(((waAutoSend.nextSendAt || 0) - Date.now()) / 1000));
      setAutoSendCountdownSec(rem);
    };
    updateTick();
    const timer = window.setInterval(updateTick, 500);
    return () => window.clearInterval(timer);
  }, [waAutoSend.running, waAutoSend.nextSendAt]);

  return (
    <div className="flex flex-col h-screen h-[100dvh] overflow-hidden bg-[#09090A] text-white font-sans antialiased selection:bg-[#C5A059] selection:text-black">
      
      {/* PHONE FRAME LAYOUT */}
      <div className="w-full max-w-md mx-auto flex-1 flex flex-col bg-[#0D0D0E] border-x border-[#232328] shadow-2xl relative overflow-hidden p-3 h-full max-h-screen">
        
        {/* GLOBAL FIXED TOP PANEL */}
        <div className="shrink-0 z-10 bg-[#0D0D0E] border-b border-[#232328] pb-2 mb-2">
          {/* HEADER BAR */}
          <div className="flex justify-between items-center mb-2 pt-1 border-b border-[#232328]/60 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#C5A059] to-[#E9D5A6] p-[1px] shadow">
                <div className="w-full h-full bg-[#121214] rounded-[11px] flex items-center justify-center text-[#D4AF37]">
                  <Smartphone className="w-4 h-4" />
                </div>
              </div>
              <div>
                <h1 className="text-sm font-extrabold text-white tracking-tight flex items-center gap-1.5">
                  KURIR ASSISTANT
                  <span className="text-[9px] bg-[#C5A059]/15 text-[#D4AF37] px-1.5 py-0.2 rounded border border-[#C5A059]/30 font-mono">
                    PRO
                  </span>
                </h1>
                <p className="text-[10px] text-neutral-400">Pengelola Alamat &amp; Paket Kurir</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={toggleWaTargetApp}
                className={`flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-lg border transition-all cursor-pointer ${
                  waTargetApp === 'business'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                    : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:bg-neutral-700'
                }`}
                title="Klik untuk beralih antara WA Business & Regular"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${waTargetApp === 'business' ? 'bg-emerald-400 animate-pulse' : 'bg-neutral-400'}`} />
                <span>{waTargetApp === 'business' ? 'WA Business' : 'WA Regular'}</span>
              </button>

              <div 
                className={`flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-lg border transition-all ${
                  isQuotaExceeded
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : saveStatus === 'syncing'
                    ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                    : saveStatus === 'saving'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                }`}
                title={isQuotaExceeded ? "Batas Kuota Harian Firestore Tercapai. Auto Save lokal tetap 100% aman." : "Auto Save aktif menyimpan posisi terbaru secara lokal. Sinkronisasi Cloud berjalan 1x sehari saat Reset Hari."}
              >
                {isQuotaExceeded ? (
                  <>
                    <Cloud className="w-3 h-3 text-amber-400" />
                    <span>Tersimpan Lokal</span>
                  </>
                ) : saveStatus === 'syncing' ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin text-sky-400" />
                    <span>Sinkron Harian...</span>
                  </>
                ) : saveStatus === 'saving' ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin text-amber-400" />
                    <span>Menyimpan...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>Auto Saved</span>
                  </>
                )}
              </div>

              <button 
                onClick={() => setShowSettingsInsidePhone(true)}
                className="p-2 rounded-xl bg-[#18181B] hover:bg-[#232328] text-neutral-300 hover:text-white border border-[#232328] transition-all cursor-pointer relative"
                title="Pengaturan Template WA & Tempat Titip"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* NAVIGATION TAB CONTROLS (KE EMPAT MODUL) */}
          <div className="grid grid-cols-4 gap-1 p-1 bg-[#141416] rounded-2xl border border-[#232328] mb-1.5">
            <button
              onClick={() => setActiveTab('filling')}
              className={`py-2 px-1 rounded-xl text-[10px] font-extrabold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                activeTab === 'filling' 
                  ? 'bg-[#232328] text-[#D4AF37] shadow border border-[#C5A059]/30' 
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-1">
                <span>FILLING</span>
              </div>
              <span className="text-[9px] font-mono opacity-70">
                ({bulkItems.length})
              </span>
            </button>

            <button
              onClick={() => setActiveTab('modul1')}
              className={`py-2 px-1 rounded-xl text-[10px] font-extrabold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                activeTab === 'modul1' 
                  ? 'bg-amber-500/20 text-amber-300 shadow border border-amber-500/40' 
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-1">
                <span>SENDING</span>
              </div>
              <span className="text-[9px] font-mono opacity-80">
                ({sumPackageCounts(modul1List)})
              </span>
            </button>

            <button
              onClick={() => setActiveTab('modul2')}
              className={`py-2 px-1 rounded-xl text-[10px] font-extrabold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                activeTab === 'modul2' 
                  ? 'bg-emerald-500/20 text-emerald-300 shadow border border-emerald-500/40' 
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-1">
                <span>SUCCESS</span>
              </div>
              <span className="text-[9px] font-mono opacity-80">
                ({sumPackageCounts(todaySuccessList)})
              </span>
            </button>

            <button
              onClick={() => setActiveTab('modul3')}
              className={`py-2 px-1 rounded-xl text-[10px] font-extrabold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                activeTab === 'modul3' 
                  ? 'bg-red-500/20 text-red-300 shadow border border-red-500/40' 
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-1">
                <span>HOLD</span>
              </div>
              <span className="text-[9px] font-mono opacity-80">
                ({sumPackageCounts(modul3List)})
              </span>
            </button>
          </div>

          {/* INPUT & SEARCH CONTROLS DOCK (GLOBAL CHAT & SEARCH) */}
          <InputDock
            inputText={inputText}
            setInputText={setInputText}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            smartRoute={smartRoute}
            handleProcessInput={handleProcessInput}
            textareaRef={textareaRef}
          />
        </div>

        {/* MAIN SCROLLABLE BODY VIEW CONTENT */}
        <div className="flex-1 overflow-y-auto pr-1 pb-3 scrollbar-none min-h-0">
          {/* MATCHING ARCHIVED CUSTOMERS DISPLAYED DIRECTLY IN SEARCH */}
          {searchQuery.trim() && matchingArchived.length > 0 && (
            <div className="mb-4 space-y-2">
              <div className="flex items-center justify-between px-1 py-1 border-b border-emerald-500/30">
                <span className="text-[11px] font-extrabold text-emerald-400 flex items-center gap-1.5 uppercase tracking-wide">
                  <Archive className="w-3.5 h-3.5 text-emerald-400" /> Ditemukan di Data Arsip ({matchingArchived.length})
                </span>
                <span className="text-[10px] text-neutral-400 font-mono">Arsip &gt;3 Hari</span>
              </div>

              {matchingArchived.map((c, idx) => {
                const dateStr = c.completedAt
                  ? new Date(c.completedAt).toLocaleDateString('id-ID', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })
                  : 'Arsip';

                return (
                  <div
                    key={`arch_${c.id}_${idx}`}
                    className="p-3 bg-[#121214] border border-emerald-500/40 rounded-xl flex flex-col gap-2 hover:border-emerald-400 transition-all shadow-md"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 w-full">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-xs font-extrabold text-white">{c.name}</span>
                          <span className="text-[9px] text-neutral-400 flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-neutral-500" /> {dateStr}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                            {c.phone}
                          </span>
                          {c.cod && c.cod !== 'NO COD' && c.cod.trim() !== '' && (
                            <span className="text-[10px] text-amber-400 font-semibold font-mono">
                              COD: {parseCodAmount(c.cod) > 0 ? formatRupiah(parseCodAmount(c.cod)) : c.cod}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-neutral-300 leading-snug">{c.address}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-[#232328]/80 mt-0.5">
                      <button
                        onClick={() => handleWhatsAppChat(c)}
                        className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20 transition-all cursor-pointer"
                      >
                        <MessageCircle className="w-3 h-3" /> Chat WA
                      </button>

                      <button
                        onClick={() => {
                          pullBackCustomer(c);
                          setActiveTab('modul1');
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/30 transition-all cursor-pointer"
                        title="Tarik paket ini kembali ke daftar Sending (Modul 1)"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Tarik ke Sending (Modul 1)
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Keep Filling mounted across tab switches so Otomatis mode continues generating & transferring per 10 items */}
          <div className={activeTab === 'filling' ? 'h-full' : 'hidden'}>
            <BulkProcessorView
              bulkItems={bulkItems}
              setBulkItems={setBulkItemsWithLock}
              customers={customers}
              setCustomers={setCustomers}
              onNavigateToSending={() => setActiveTab('modul1')}
              onClearFilling={() => setBulkItemsWithLock([])}
              isActive={activeTab === 'filling'}
              onAutoTransferBatchToSending={handleAutoTransferBatchToSending}
            />
          </div>

          {activeTab === 'filling' ? null : activeTab === 'modul2' ? (
            <SuccessView
              filteredCustomers={filteredCustomers}
              allSuccessList={allSuccessList}
              todaySuccessList={todaySuccessList}
              codTodayNominal={codTodayNominal}
              setShowResetModal={setShowResetModal}
              tempatCodList={tempatCodList}
              editingCodId={editingCodId}
              editingCodText={editingCodText}
              setEditingCodId={setEditingCodId}
              setEditingCodText={setEditingCodText}
              handleSaveCodAmount={handleSaveCodAmount}
              handleWhatsAppChat={handleWhatsAppChat}
              setDropOffModalCustomer={setDropOffModalCustomer}
              updatePaymentType={updatePaymentType}
              setCameraActiveForId={setCameraActiveForId}
              selectedPhotos={selectedPhotos}
              togglePhotoSelection={togglePhotoSelection}
              deleteCustomerPhoto={deleteCustomerPhoto}
              setLightboxPhoto={setLightboxPhoto}
              deleteCustomer={deleteCustomer}
              moveToModul2={moveToModul2}
              moveToModul3AndCapture={moveToModul3AndCapture}
              returnToModul1={returnToModul1}
              toggleCustomerCompletedDate={toggleCustomerCompletedDate}
              customerChatHistoryMap={customerChatHistoryMap}
              checkingWaCustomerId={checkingWaCustomerId}
            />
          ) : (
            /* SENDING (Modul 1) & HOLD (Modul 3) LISTS */
            <>
              {activeTab === 'modul1' && (
                <div className="mb-2.5 space-y-2">
                  {/* Sending-only Open Source Baileys Auto-Send Bar */}
                  <div className="bg-[#141417] border border-[#24242A] rounded-xl p-2 flex items-center justify-between gap-2 shadow-sm">
                    <button
                      type="button"
                      onClick={() => {
                        setShowWaConnectModal(true);
                        if (waGateway.status === 'disconnected') {
                          void connectWaGatewayClient().catch(() => {});
                        }
                      }}
                      className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border flex items-center gap-1.5 transition-all cursor-pointer min-w-0 ${
                        waGateway.status === 'connected'
                          ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                          : 'bg-neutral-900 text-neutral-300 border-neutral-800 hover:border-[#C5A059]/40'
                      }`}
                      title="Kelola koneksi WhatsApp Baileys (QR / Pairing Code)"
                    >
                      {waGateway.status === 'connected' ? (
                        <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : waGateway.status === 'qr_ready' || waGateway.status === 'connecting' ? (
                        <QrCode className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      ) : (
                        <WifiOff className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                      )}
                      <span className="truncate">
                        {waGateway.status === 'connected'
                          ? `WA Aktif (${waGateway.knownChatsCount} chat)`
                          : waGateway.status === 'qr_ready'
                          ? 'Scan QR / Pairing'
                          : waGateway.status === 'connecting'
                          ? 'Menghubungkan...'
                          : 'Hubungkan WA'}
                      </span>
                    </button>

                    {waAutoSend.running ? (
                      <button
                        type="button"
                        onClick={handlePauseAutoSendSending}
                        className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 text-[10px] font-extrabold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm shrink-0"
                        title="Jeda sementara pengiriman otomatis dan lanjutkan nanti dari urutan terakhir"
                      >
                        <Pause className="w-3 h-3 fill-current" />
                        Pause Send
                      </button>
                    ) : waAutoSend.phase === 'paused' ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={handleResumeAutoSendSending}
                          disabled={filteredCustomers.length === 0}
                          className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#C5A059] to-[#D4AF37] hover:brightness-110 disabled:opacity-40 text-black text-[10px] font-extrabold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                          title={`Lanjutkan kirim otomatis dari urutan berikutnya (${waAutoSend.processed}/${waAutoSend.total})`}
                        >
                          <Play className="w-3 h-3 fill-current" />
                          Lanjutkan Send
                        </button>
                        <button
                          type="button"
                          onClick={handleResetAutoSendSending}
                          className="p-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white border border-neutral-800 transition-all cursor-pointer"
                          title="Reset antrean kirim otomatis agar bisa mulai dari awal"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : filteredCustomers.length > 0 && pendingAutoSendCustomers.length === 0 ? (
                      <button
                        type="button"
                        disabled
                        className="px-3 py-1.5 rounded-lg bg-neutral-800/80 text-neutral-400 border border-neutral-700/60 text-[10px] font-extrabold flex items-center gap-1.5 opacity-60 cursor-not-allowed shrink-0"
                        title="Semua data Sending telah selesai di-automasi. Tombol akan aktif kembali saat ada data baru masuk."
                      >
                        <CheckCircle className="w-3 h-3 text-emerald-400" />
                        Automasi Selesai
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleStartAutoSendSending}
                        disabled={pendingAutoSendCustomers.length === 0}
                        className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#C5A059] to-[#D4AF37] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-black text-[10px] font-extrabold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm shrink-0"
                        title="Mulai kirim pesan WhatsApp otomatis (jeda 10-20 detik, maks. 1x/hari ke nomor sama)"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        Mulai Kirim Otomatis
                        {pendingAutoSendCustomers.length > 0 && pendingAutoSendCustomers.length < filteredCustomers.length
                          ? ` (${pendingAutoSendCustomers.length})`
                          : ''}
                      </button>
                    )}
                  </div>

                  {/* Automatic read-only pre-scan progress banner (non-blocking) */}
                  {waPrecheck.running && !waAutoSend.running && (
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-[10px] text-emerald-200">
                      <span className="flex items-center gap-1.5 min-w-0 truncate">
                        <RefreshCw className="w-3 h-3 animate-spin text-emerald-400 shrink-0" />
                        <span className="truncate">
                          Membaca pesan urutan {Math.min(waPrecheck.completed + 1, waPrecheck.total)}/{waPrecheck.total}
                          {waPrecheck.currentCustomerName ? ` (${waPrecheck.currentCustomerName})` : ''}...
                        </span>
                      </span>
                      <span className="text-[9px] font-bold text-emerald-300 shrink-0">Siap Auto-Send</span>
                    </div>
                  )}

                  {/* Manual Skip Counter Pill (when user marks cards to skip) */}
                  {(() => {
                    const manualSkipCount = filteredCustomers.filter((c) => c.manualSkipAutoSend).length;
                    if (manualSkipCount === 0) return null;
                    return (
                      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-[10px] text-sky-200">
                        <span className="flex items-center gap-1.5 font-semibold truncate">
                          <SkipForward className="w-3 h-3 text-sky-400 shrink-0" />
                          <span>{manualSkipCount} kartu ditandai Skip Manual (akan dilompati)</span>
                        </span>
                        <button
                          type="button"
                          onClick={handleClearAllManualSkips}
                          className="px-2 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 border border-sky-500/30 text-[9px] font-bold shrink-0 cursor-pointer"
                        >
                          Reset Skip
                        </button>
                      </div>
                    );
                  })()}

                  {/* Pending Filling Otomatis notice when WA gateway is not connected yet */}
                  {waitingWaFillingAutoCount > 0 && waGateway.status !== 'connected' && (
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-200">
                      <span className="truncate font-semibold">
                        {waitingWaFillingAutoCount} data Filling siap auto-kirim (jeda 1 menit) — hubungkan WA dulu.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowWaConnectModal(true);
                          if (waGateway.status === 'disconnected') {
                            void connectWaGatewayClient().catch(() => {});
                          }
                        }}
                        className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 text-[9px] font-bold shrink-0 cursor-pointer"
                      >
                        Hubungkan
                      </button>
                    </div>
                  )}

                  {/* Auto-Send Live Progress & Result Summary Banner */}
                  {showAutoSendBanner && waAutoSend.phase !== 'idle' && (
                    <div
                      className={`rounded-xl p-2.5 border text-[10px] space-y-1.5 ${
                        waAutoSend.running || waAutoSend.phase === 'paused'
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                          : waAutoSend.phase === 'completed'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                          : 'bg-neutral-900 border-neutral-800 text-neutral-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-bold flex items-center gap-1.5 min-w-0">
                          {waAutoSend.running && (
                            <RefreshCw className="w-3 h-3 animate-spin text-amber-400 shrink-0" />
                          )}
                          <span className="truncate">
                            {waAutoSend.phase === 'waiting_delay'
                              ? waAutoSend.isInitialDelay
                                ? `Jeda awal ${autoSendCountdownSec}d sebelum kirim otomatis dimulai (${waAutoSend.total} data)`
                                : `Jeda aman ${autoSendCountdownSec}d sebelum kirim ke ${waAutoSend.currentCustomerName}`
                              : waAutoSend.phase === 'sending' || waAutoSend.phase === 'checking'
                              ? `Memproses: ${waAutoSend.currentCustomerName || '...'} (${waAutoSend.processed}/${waAutoSend.total})`
                              : waAutoSend.phase === 'paused'
                              ? `Dijeda pada ${waAutoSend.processed}/${waAutoSend.total} — siap lanjut urutan berikutnya`
                              : waAutoSend.phase === 'completed'
                              ? `Kirim otomatis selesai (${waAutoSend.processed}/${waAutoSend.total})`
                              : `Kirim otomatis dihentikan (${waAutoSend.processed}/${waAutoSend.total})`}
                          </span>
                        </div>
                        {!waAutoSend.running && waAutoSend.phase !== 'paused' && (
                          <button
                            type="button"
                            onClick={() => setShowAutoSendBanner(false)}
                            className="p-0.5 rounded hover:bg-white/10 text-neutral-400 hover:text-white cursor-pointer shrink-0"
                            title="Tutup ringkasan"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 text-[9px] font-mono opacity-90">
                        <span className="text-emerald-300">Lengkap: {waAutoSend.sentFullCount}</span>
                        <span>•</span>
                        <span className="text-[#E9D5A6]">COD Saja: {waAutoSend.sentCodOnlyCount}</span>
                        <span>•</span>
                        <span className="text-sky-300">Skip: {waAutoSend.skippedCount}</span>
                        <span>•</span>
                        <span className="text-red-300">Gagal: {waAutoSend.failedCount}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {filteredCustomers.length === 0 ? (
                matchingArchived.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-neutral-500 space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-[#141416] border border-[#232328] flex items-center justify-center text-neutral-600">
                      <CheckCircle className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-neutral-400">Tidak ada paket di daftar ini</p>
                      <p className="text-[10px] text-neutral-600 mt-0.5">
                        {searchQuery ? 'Tidak ada hasil pencarian.' : 'Tempel data / nama di kolom atas.'}
                      </p>
                    </div>
                  </div>
                ) : null
              ) : (
                <div className="space-y-2">
                  <AnimatePresence mode="popLayout">
                    {(() => {
                      let runningSeq = 1;
                      return filteredCustomers.map((cust) => {
                        const cardSeq = runningSeq;
                        runningSeq += getPackageCount(cust);
                        const custNormPhone = cust.cleanPhone || cleanPhoneNumber(cust.phone || '');
                        const custHistory = customerChatHistoryMap[custNormPhone];
                        const isPrecheckingCard =
                          activeTab === 'modul1' &&
                          waPrecheck.running &&
                          (waPrecheck.currentCustomerId === cust.id ||
                            (Boolean(custNormPhone) && waPrecheck.currentCustomerPhone === custNormPhone));
                        const hasPrecheckedCard =
                          activeTab === 'modul1' &&
                          (Boolean(custHistory?.deepChecked) ||
                            (Boolean(custNormPhone) && Boolean(waPrecheck.checkedPhones?.includes(custNormPhone))));
                        return (
                          <CustomerCard
                            key={`${activeTab}_${cust.id}`}
                            cust={cust}
                            displayIndex={cardSeq}
                            activeTab={activeTab}
                            tempatCodList={tempatCodList}
                            editingCodId={editingCodId}
                            editingCodText={editingCodText}
                            setEditingCodId={setEditingCodId}
                            setEditingCodText={setEditingCodText}
                            handleSaveCodAmount={handleSaveCodAmount}
                            handleWhatsAppChat={handleWhatsAppChat}
                            setDropOffModalCustomer={setDropOffModalCustomer}
                            updatePaymentType={updatePaymentType}
                            setCameraActiveForId={setCameraActiveForId}
                            selectedPhotos={selectedPhotos}
                            togglePhotoSelection={togglePhotoSelection}
                            deleteCustomerPhoto={deleteCustomerPhoto}
                            setLightboxPhoto={setLightboxPhoto}
                            deleteCustomer={deleteCustomer}
                            moveToModul2={moveToModul2}
                            moveToModul3AndCapture={moveToModul3AndCapture}
                            returnToModul1={returnToModul1}
                            toggleManualSkipAutoSend={activeTab === 'modul1' ? toggleManualSkipAutoSend : undefined}
                            autoSendItem={activeTab === 'modul1' ? waAutoSend.items[cust.id] : undefined}
                            chatHistory={custHistory}
                            isCheckingWa={checkingWaCustomerId === cust.id}
                            isPrecheckingWa={isPrecheckingCard}
                            hasBeenPrechecked={hasPrecheckedCard}
                            isDailySentToday={
                              activeTab === 'modul1'
                                ? dailySentPhones.has(custNormPhone)
                                : false
                            }
                          />
                        );
                      });
                    })()}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}
        </div>

        {/* FLOATING ACTION BAR FOR SELECTED PHOTOS */}
        <FloatingPhotoBar
          selectedPhotos={selectedPhotos}
          setSelectedPhotos={setSelectedPhotos}
          setShowWASheet={setShowWASheet}
        />

        {/* WHATSAPP ACTION SHEET */}
        <WASheetModal
          showWASheet={showWASheet}
          setShowWASheet={setShowWASheet}
          handleSendPhotosToWhatsApp={handleSendPhotosToWhatsApp}
        />

        {/* LIVE CAMERA MODAL OVERLAY */}
        <LiveCameraModal
          cameraActiveForId={cameraActiveForId}
          cameraCustomer={cameraCustomer}
          setCameraActiveForId={setCameraActiveForId}
          cameraError={cameraError}
          videoRef={videoRef}
          cameraStream={cameraStream}
          capturePhoto={capturePhoto}
          handleFallbackPhotoUpload={handleFallbackPhotoUpload}
          handleGalleryUpload={handleGalleryUpload}
          deleteCustomerPhoto={deleteCustomerPhoto}
          sessionPhotos={cameraCustomer?.status === 'modul1' ? sendingSessionPhotos : undefined}
          sessionLocationUrl={cameraCustomer?.status === 'modul1' ? sendingSessionLocationUrl : undefined}
          isFetchingSessionGps={cameraCustomer?.status === 'modul1' ? isFetchingSendingGps : false}
          waReportNumber={waReportNumber}
          waGatewayStatus={waGateway.status}
          tempatCodList={tempatCodList}
          holdGroupOptions={holdGroups}
          selectedHoldGroupUrl={selectedHoldGroupUrl}
          onSelectHoldGroupUrl={handleSelectHoldGroupUrl}
          onSendCameraToWaBusiness={handleSendCameraToWaBusiness}
          onSendHoldCameraBundle={handleSendHoldCameraBundle}
          onOpenWaConnectModal={() => {
            setShowWaConnectModal(true);
            if (waGateway.status === 'disconnected') {
              void connectWaGatewayClient().catch(() => {});
            }
          }}
          onOpenSettingsFromCamera={() => {
            setCameraActiveForId(null);
            setShowSettingsInsidePhone(true);
          }}
        />

        {/* LIGHTBOX MODAL */}
        <PhotoLightboxModal
          lightboxPhoto={lightboxPhoto}
          setLightboxPhoto={setLightboxPhoto}
        />

        {/* DROP-OFF LOCATION MODAL */}
        <DropOffLocationModal
          dropOffModalCustomer={dropOffModalCustomer}
          setDropOffModalCustomer={setDropOffModalCustomer}
          tempatCodList={tempatCodList}
          handleWhatsAppChat={handleWhatsAppChat}
        />

        {/* DAY CHANGE ALERT MODAL */}
        <DayChangeHoldModal
          showDayChangePopup={showDayChangePopup}
          setShowDayChangePopup={setShowDayChangePopup}
          holdCountTodayAlert={holdCountTodayAlert}
          setActiveTab={setActiveTab}
        />

        {/* SETTINGS OVERLAY MODAL */}
        <SettingsModal
          showSettingsInsidePhone={showSettingsInsidePhone}
          setShowSettingsInsidePhone={setShowSettingsInsidePhone}
          msgTemplateCod={msgTemplateCod}
          setMsgTemplateCod={setMsgTemplateCod}
          msgTemplateNoCod={msgTemplateNoCod}
          setMsgTemplateNoCod={setMsgTemplateNoCod}
          msgTemplateTitip={msgTemplateTitip}
          setMsgTemplateTitip={setMsgTemplateTitip}
          msgTemplateAutoCodOnly={msgTemplateAutoCodOnly}
          setMsgTemplateAutoCodOnly={setMsgTemplateAutoCodOnly}
          tempatCodList={tempatCodList}
          handleResetDefaultLocations={handleResetDefaultLocations}
          handleDeleteLocation={handleDeleteLocation}
          handleUpdateLocationAddress={handleUpdateLocationAddress}
          newLocationName={newLocationName}
          setNewLocationName={setNewLocationName}
          newLocationAddress={newLocationAddress}
          setNewLocationAddress={setNewLocationAddress}
          handleAddLocation={handleAddLocation}
          setShowResetModal={setShowResetModal}
          loadSampleData={loadSampleData}
          clearAllData={clearAllData}
          customers={customers}
          handleRunAutoArchiveNow={handleRunAutoArchiveNow}
          setShowArchiveModal={setShowArchiveModal}
          archivedCount={archivedCustomers.length}
          isArchiving={isArchiving}
          waTargetApp={waTargetApp}
          toggleWaTargetApp={toggleWaTargetApp}
          waReportNumber={waReportNumber}
          setWaReportNumber={setWaReportNumber}
        />

        {/* WHATSAPP AUTO CONNECT (BAILEYS) MODAL */}
        <WAAutoConnectModal
          show={showWaConnectModal}
          onClose={() => setShowWaConnectModal(false)}
          gateway={waGateway}
          onConnect={connectWaGatewayClient}
          onRequestPairingCode={requestWaPairingCodeClient}
          onLogout={logoutWaGatewayClient}
          onRefreshStatus={refreshWaGatewayStatus}
        />

        {/* ARCHIVE & SEARCH MODAL */}
        <ArchiveModal
          showArchiveModal={showArchiveModal}
          setShowArchiveModal={setShowArchiveModal}
          archivedCustomers={archivedCustomers}
          pullBackCustomer={pullBackCustomer}
        />

        {/* RESET / ATUR HITUNGAN SUKSES MODAL */}
        <ResetSuccessModal
          showResetModal={showResetModal}
          setShowResetModal={setShowResetModal}
          todaySuccessList={todaySuccessList}
          allSuccessList={allSuccessList}
          handleResetTodayCountToZero={handleResetTodayCountToZero}
          handleReturnTodaySuccessToSending={handleReturnTodaySuccessToSending}
          handleClearAllSuccessData={handleClearAllSuccessData}
          handleArchiveAllSuccessData={handleArchiveAllSuccessData}
        />

        {/* WHATSAPP NOT REGISTERED ALERT POPUP */}
        <AnimatePresence>
          {waErrorModal?.show && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
              onClick={() => setWaErrorModal(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 10 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-[#18181B] border border-red-500/40 rounded-2xl p-5 max-w-sm w-full text-center shadow-2xl relative overflow-hidden"
              >
                <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto mb-3">
                  <PhoneOff className="w-6 h-6" />
                </div>

                <h3 className="text-sm font-extrabold text-white mb-1">
                  Nomor WA Tidak Terdaftar / Invalid
                </h3>
                
                <div className="bg-neutral-900/80 rounded-xl p-3 border border-neutral-800 my-3 text-left">
                  <p className="text-[11px] text-neutral-400 mb-1">
                    Pelanggan: <span className="text-white font-bold">{waErrorModal.customerName}</span>
                  </p>
                  <p className="text-[11px] text-neutral-400">
                    Nomor HP: <span className="text-red-400 font-mono font-bold">{waErrorModal.phone || '(Kosong / Format Salah)'}</span>
                  </p>
                </div>

                <p className="text-[11px] text-neutral-300 mb-4 leading-relaxed">
                  Pesan tidak dapat dikirim karena nomor telepon tidak terdaftar di WhatsApp atau format nomor tidak valid. Anda telah dikembalikan ke aplikasi.
                </p>

                <button
                  onClick={() => setWaErrorModal(null)}
                  className="w-full py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl transition-all shadow-lg cursor-pointer"
                >
                  Kembali ke Aplikasi
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
