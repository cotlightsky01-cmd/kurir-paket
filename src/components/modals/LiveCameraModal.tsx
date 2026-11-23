import React, { useState, useEffect } from 'react';
import { Camera, X, Upload, Image as ImageIcon, Send, Check, Settings, MapPin, Loader2, Phone } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Customer, TempatCodLocation } from '../../types';
import { cleanPhoneNumber, buildHoldCameraTemplateText, buildHoldOhReturnTemplateText } from '../../utils/helpers';

interface LiveCameraModalProps {
  cameraActiveForId: string | null;
  cameraCustomer?: Customer;
  setCameraActiveForId: (id: string | null) => void;
  cameraError: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraStream: MediaStream | null;
  capturePhoto: () => void;
  handleFallbackPhotoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleGalleryUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  deleteCustomerPhoto: (customerId: string, photoIndex: number) => void;
  sessionPhotos?: string[];
  sessionLocationUrl?: string | null;
  isFetchingSessionGps?: boolean;
  waReportNumber?: string;
  tempatCodList?: TempatCodLocation[];
  waTargetApp?: 'business' | 'regular';
  onSendCameraToWaBusiness?: (
    customer: Customer,
    photoUrl: string,
    gpsUrl?: string | null
  ) => Promise<{ ok: boolean; method: 'web_share' | 'download_fallback' | 'cancelled' | 'error'; messageText?: string; copiedPhone?: string | null }>;
  onSendTextToWaBusiness?: (messageText: string) => void;
  onSendHoldCameraToCustomer?: (
    customer: Customer,
    photoUrl: string,
    messageText: string
  ) => Promise<{ ok: boolean; method: 'web_share' | 'download_fallback' | 'cancelled' | 'error'; messageText?: string; copiedPhone?: string | null }>;
  onOpenHoldCustomerWaChat?: (customer: Customer, messageText: string) => void;
  onShareHoldOhReturn?: (
    customer: Customer,
    photoUrl: string,
    ohReturnType: 'oh' | 'return',
    customText?: string
  ) => Promise<{ ok: boolean; method: 'web_share' | 'download_fallback' | 'cancelled' | 'error'; messageText?: string; copiedPhone?: string | null }>;
  onOpenSettingsFromCamera?: () => void;
}

export const LiveCameraModal: React.FC<LiveCameraModalProps> = ({
  cameraActiveForId,
  cameraCustomer,
  setCameraActiveForId,
  cameraError,
  videoRef,
  cameraStream,
  capturePhoto,
  handleFallbackPhotoUpload,
  handleGalleryUpload,
  deleteCustomerPhoto,
  sessionPhotos,
  sessionLocationUrl,
  isFetchingSessionGps = false,
  waReportNumber = '',
  tempatCodList = [],
  waTargetApp = 'business',
  onSendCameraToWaBusiness,
  onSendTextToWaBusiness,
  onSendHoldCameraToCustomer,
  onOpenHoldCustomerWaChat,
  onShareHoldOhReturn,
  onOpenSettingsFromCamera,
}) => {
  const isSendingModule = cameraCustomer?.status === 'modul1';
  const isHoldModule = cameraCustomer?.status === 'modul3';
  const activePhotos = isSendingModule ? (sessionPhotos || []) : (cameraCustomer?.photos || []);
  const photosCount = activePhotos.length;
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState<number>(0);
  const [isSendingWa, setIsSendingWa] = useState(false);
  const [sendFeedback, setSendFeedback] = useState<string | null>(null);
  const [lastSentMessageText, setLastSentMessageText] = useState<string | null>(null);

  // Hold template state: automatically detects whether customer previously chose "di titipkan"
  const [holdIsTitip, setHoldIsTitip] = useState<boolean>(false);
  const [holdTitipLocation, setHoldTitipLocation] = useState<string>('');
  const [holdTemplateText, setHoldTemplateText] = useState<string>('');
  const [holdSpecialMode, setHoldSpecialMode] = useState<'' | 'oh' | 'return'>('');

  // Reset template mode when camera opens/switches customer
  useEffect(() => {
    if (!cameraCustomer || cameraCustomer.status !== 'modul3') {
      setHoldIsTitip(false);
      setHoldTitipLocation('');
      setHoldTemplateText('');
      setHoldSpecialMode('');
      return;
    }

    const wasTitipSelected =
      cameraCustomer.waLastTemplateType === 'titip' && Boolean(cameraCustomer.titipLocationName);
    const defaultLoc =
      cameraCustomer.titipLocationName || tempatCodList[0]?.name || 'tempat titip';

    setHoldSpecialMode('');
    setHoldIsTitip(wasTitipSelected);
    setHoldTitipLocation(defaultLoc);
    setHoldTemplateText(
      buildHoldCameraTemplateText(cameraCustomer.name, wasTitipSelected, defaultLoc)
    );
  }, [
    cameraActiveForId,
    cameraCustomer?.id,
    cameraCustomer?.status,
    cameraCustomer?.waLastTemplateType,
    cameraCustomer?.titipLocationName,
  ]);

  // Automatically select the latest photo whenever photo count changes or customer changes
  useEffect(() => {
    if (photosCount > 0) {
      setSelectedPhotoIdx(photosCount - 1);
    } else {
      setSelectedPhotoIdx(0);
    }
    setSendFeedback(null);
    setLastSentMessageText(null);
  }, [cameraActiveForId, photosCount]);

  const cleanedTarget = waReportNumber.trim() ? cleanPhoneNumber(waReportNumber.trim()) : '';
  const customerRegisteredPhone = cameraCustomer
    ? (cameraCustomer.cleanPhone || cleanPhoneNumber(cameraCustomer.phone || ''))
    : '';

  const handleToggleHoldTemplateType = (useTitip: boolean, locOverride?: string) => {
    if (!cameraCustomer) return;
    const nextLoc = locOverride ?? holdTitipLocation ?? tempatCodList[0]?.name ?? 'tempat titip';
    setHoldSpecialMode('');
    setHoldIsTitip(useTitip);
    setHoldTitipLocation(nextLoc);
    setHoldTemplateText(buildHoldCameraTemplateText(cameraCustomer.name, useTitip, nextLoc));
  };

  const handleOhReturnDropdownChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = e.target.value as '' | 'oh' | 'return';
    if (!selected || !cameraCustomer || !onShareHoldOhReturn || photosCount === 0 || isSendingWa) {
      return;
    }

    setHoldSpecialMode(selected);
    const specialText = buildHoldOhReturnTemplateText(cameraCustomer, selected);
    setHoldTemplateText(specialText);

    const safeIdx = Math.min(Math.max(0, selectedPhotoIdx), photosCount - 1);
    const selectedPhotoUrl = activePhotos[safeIdx];

    setIsSendingWa(true);
    try {
      const result = await onShareHoldOhReturn(cameraCustomer, selectedPhotoUrl, selected, specialText);
      if (result.messageText) {
        setLastSentMessageText(result.messageText);
      }
      const label = selected === 'oh' ? 'OH' : 'Return';
      if (result.ok && result.method === 'web_share') {
        setSendFeedback(
          `Foto & template ${label} dibagikan lewat Web Share.${result.copiedPhone ? ` Nomor ${result.copiedPhone} disalin ke clipboard (tinggal tempel di pencarian WhatsApp).` : ''}`
        );
      } else if (result.ok && result.method === 'download_fallback') {
        setSendFeedback(
          `Browser/iframe membatasi Share File: foto diunduh & teks ${label} dibuka di WhatsApp Business.${result.copiedPhone ? ` Nomor ${result.copiedPhone} disalin.` : ''}`
        );
      } else if (result.method === 'cancelled') {
        setSendFeedback(
          `Web Share ${label} dibatalkan.${result.copiedPhone ? ` Nomor ${result.copiedPhone} tetap tersalin di clipboard.` : ''}`
        );
      } else {
        setSendFeedback(`Gagal membagikan foto & template ${label}.`);
      }
    } finally {
      setIsSendingWa(false);
    }
  };

  const handleTriggerSend = async () => {
    if (!cameraCustomer || photosCount === 0 || isSendingWa) return;

    const safeIdx = Math.min(Math.max(0, selectedPhotoIdx), photosCount - 1);
    const selectedPhotoUrl = activePhotos[safeIdx];

    if (isHoldModule && holdSpecialMode && onShareHoldOhReturn) {
      setIsSendingWa(true);
      try {
        const finalMessage =
          holdTemplateText.trim() || buildHoldOhReturnTemplateText(cameraCustomer, holdSpecialMode);
        const result = await onShareHoldOhReturn(cameraCustomer, selectedPhotoUrl, holdSpecialMode, finalMessage);
        if (result.messageText) {
          setLastSentMessageText(result.messageText);
        }
        const label = holdSpecialMode === 'oh' ? 'OH' : 'Return';
        if (result.ok && result.method === 'web_share') {
          setSendFeedback(
            `Foto & template ${label} dibagikan lewat Web Share.${result.copiedPhone ? ` Nomor ${result.copiedPhone} disalin ke clipboard.` : ''}`
          );
        } else if (result.ok && result.method === 'download_fallback') {
          setSendFeedback(
            `Browser/iframe membatasi Share File: foto diunduh & teks ${label} dibuka di WhatsApp Business.${result.copiedPhone ? ` Nomor ${result.copiedPhone} disalin.` : ''}`
          );
        } else if (result.method === 'cancelled') {
          setSendFeedback(
            `Web Share ${label} dibatalkan.${result.copiedPhone ? ` Nomor ${result.copiedPhone} tetap tersalin di clipboard.` : ''}`
          );
        } else {
          setSendFeedback(`Gagal membagikan foto & template ${label}.`);
        }
      } finally {
        setIsSendingWa(false);
      }
      return;
    }

    if (isHoldModule && onSendHoldCameraToCustomer) {
      setIsSendingWa(true);
      try {
        const finalMessage =
          holdTemplateText.trim() ||
          buildHoldCameraTemplateText(cameraCustomer.name, holdIsTitip, holdTitipLocation);
        const result = await onSendHoldCameraToCustomer(cameraCustomer, selectedPhotoUrl, finalMessage);
        if (result.messageText) {
          setLastSentMessageText(result.messageText);
        }
        if (result.ok && result.method === 'web_share') {
          setSendFeedback(
            `Foto & template dibagikan lewat Share Sheet.${result.copiedPhone ? ` Nomor ${result.copiedPhone} disalin ke clipboard (tinggal tempel di pencarian WhatsApp).` : ''}`
          );
        } else if (result.ok && result.method === 'download_fallback') {
          setSendFeedback(
            `Browser/iframe membatasi Share File: foto diunduh ke Galeri/Download & chat ${customerRegisteredPhone} dibuka dengan template.${result.copiedPhone ? ` Nomor ${result.copiedPhone} disalin ke clipboard.` : ''}`
          );
        } else if (result.method === 'cancelled') {
          setSendFeedback(
            `Pengiriman Share Sheet dibatalkan.${result.copiedPhone ? ` Nomor ${result.copiedPhone} tetap tersalin di clipboard.` : ''}`
          );
        } else {
          setSendFeedback('Nomor buyer tidak terdaftar/invalid atau gagal menyiapkan foto.');
        }
      } finally {
        setIsSendingWa(false);
      }
      return;
    }

    if (isSendingModule && onSendCameraToWaBusiness) {
      setIsSendingWa(true);
      try {
        const result = await onSendCameraToWaBusiness(cameraCustomer, selectedPhotoUrl, sessionLocationUrl);
        if (result.messageText) {
          setLastSentMessageText(result.messageText);
        }
        if (result.ok && result.method === 'web_share') {
          setSendFeedback(
            `Foto & data (Nama, Alamat, GPS) dibagikan melalui Share Sheet ke WhatsApp Business.${result.copiedPhone ? ` Nomor ${result.copiedPhone} disalin ke clipboard (tinggal tempel di pencarian WhatsApp).` : ''}`
          );
        } else if (result.ok && result.method === 'download_fallback') {
          setSendFeedback(
            `Browser/iframe membatasi Share File: foto diunduh otomatis & data teks dibuka di WhatsApp Business.${result.copiedPhone ? ` Nomor ${result.copiedPhone} disalin ke clipboard.` : ''}`
          );
        } else if (result.method === 'cancelled') {
          setSendFeedback(
            `Pengiriman Share Sheet dibatalkan.${result.copiedPhone ? ` Nomor ${result.copiedPhone} tetap tersalin di clipboard.` : ''}`
          );
        } else {
          setSendFeedback('Gagal menyiapkan foto untuk dikirim.');
        }
      } finally {
        setIsSendingWa(false);
      }
    }
  };

  return (
    <AnimatePresence>
      {cameraActiveForId && cameraCustomer && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="fixed inset-2 sm:inset-10 md:inset-x-20 lg:inset-x-32 xl:inset-x-60 top-4 bottom-4 bg-[#0B0B0C]/98 border border-[#2A2A30] rounded-2xl z-50 flex flex-col overflow-hidden p-4 shadow-2xl"
        >
          {/* Camera header */}
          <div className="flex justify-between items-center mb-3">
            <div className="min-w-0 pr-2">
              {isHoldModule ? (
                <>
                  <span className="text-[10px] tracking-widest uppercase text-amber-500 font-extrabold flex items-center gap-1">
                    <Camera className="w-3.5 h-3.5" /> KAMERA PAKET (HOLD - SEMENTARA)
                  </span>
                  <p className="text-[9px] text-amber-400/80 font-medium">
                    Foto sementara + template pesan otomatis ke nomor terdaftar pelanggan.
                  </p>
                </>
              ) : (
                <>
                  <span className="text-[10px] tracking-widest uppercase text-emerald-400 font-extrabold flex items-center gap-1">
                    <Camera className="w-3.5 h-3.5" /> KAMERA KIRIM WA BUSINESS (+ LOKASI GPS)
                  </span>
                  <p className="text-[9px] text-emerald-400/80 font-medium">
                    Foto &amp; GPS sementara untuk dikirim langsung, tidak disimpan permanen.
                  </p>
                </>
              )}
              <h4 className="text-xs font-bold text-white mt-0.5 line-clamp-1">
                {cameraCustomer.name}
              </h4>
            </div>
            <button 
              onClick={() => setCameraActiveForId(null)}
              className="p-1.5 rounded-full bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Viewfinder Canvas area */}
          <div className="flex-1 bg-black rounded-2xl border border-neutral-800 relative overflow-hidden flex items-center justify-center min-h-0">
            {!cameraError ? (
              <video 
                ref={videoRef}
                autoPlay 
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="p-6 text-center space-y-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto border border-amber-500/20">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[11px] font-bold text-neutral-300">Akses Kamera Iframe Terbatas</p>
                  <p className="text-[9px] text-neutral-500 max-w-[220px] mx-auto mt-1 leading-normal">
                    Gunakan tombol <span className="text-white font-semibold">Kamera</span> di bawah untuk foto langsung, atau tombol <span className="text-[#C5A059] font-semibold">Galeri</span> untuk memilih foto dari galeri HP.
                  </p>
                </div>
              </div>
            )}

            {/* Photo overlay counts */}
            <span className={`absolute top-3 left-3 bg-black/80 text-[10px] font-bold px-2.5 py-1 rounded-full border shadow-md ${
              isHoldModule
                ? 'text-amber-400 border-amber-500/40'
                : 'text-emerald-400 border-emerald-500/40'
            }`}>
              {isHoldModule
                ? `${photosCount} Tersimpan (Sementara)`
                : `${photosCount} Foto Siap Kirim (Sementara)`}
            </span>

            {/* GPS status badge for Sending module */}
            {isSendingModule && (
              <div className={`absolute top-3 right-3 bg-black/80 text-[10px] font-bold px-2.5 py-1 rounded-full border shadow-md flex items-center gap-1 ${
                sessionLocationUrl
                  ? 'text-emerald-400 border-emerald-500/40'
                  : isFetchingSessionGps
                    ? 'text-amber-300 border-amber-500/40'
                    : 'text-neutral-300 border-neutral-700'
              }`}>
                {isFetchingSessionGps ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Mencari GPS...</span>
                  </>
                ) : sessionLocationUrl ? (
                  <>
                    <MapPin className="w-3 h-3" />
                    <span>GPS Siap</span>
                  </>
                ) : (
                  <>
                    <MapPin className="w-3 h-3" />
                    <span>GPS saat kirim</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Captured thumbnail carousel within Camera view */}
          {activePhotos.length > 0 && (
            <div className="mt-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-bold text-neutral-500 tracking-wider">
                  HASIL CAPTURE (Ketuk untuk pilih foto dikirim):
                </span>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none">
                {activePhotos.map((ph, index) => {
                  const isSelected = index === Math.min(selectedPhotoIdx, photosCount - 1);
                  return (
                    <div
                      key={`cam_ph_${cameraCustomer.id}_${index}`}
                      onClick={() => setSelectedPhotoIdx(index)}
                      className={`w-12 h-12 rounded-lg overflow-hidden shrink-0 relative group cursor-pointer transition-all ${
                        isSelected
                          ? isHoldModule
                            ? 'ring-2 ring-amber-400 border border-amber-400'
                            : 'ring-2 ring-emerald-400 border border-emerald-400'
                          : 'border border-neutral-800'
                      }`}
                    >
                      <img src={ph} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      {isSelected && (
                        <span className={`absolute bottom-0.5 left-0.5 w-3.5 h-3.5 rounded-full text-black flex items-center justify-center ${
                          isHoldModule ? 'bg-amber-400' : 'bg-emerald-500'
                        }`}>
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteCustomerPhoto(cameraCustomer.id, index);
                        }}
                        className="absolute -top-0.5 -right-0.5 p-0.5 bg-red-600 rounded-full text-white cursor-pointer"
                      >
                        <X className="w-2 h-2" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Hold Module: Template Caption & Registered Customer Phone Bar when photo is captured */}
          {isHoldModule && activePhotos.length > 0 && (
            <div className="mt-2 p-2.5 rounded-xl bg-[#141416] border border-amber-500/30 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Phone className="w-3 h-3 text-amber-400 shrink-0" />
                  <span className="text-neutral-400 font-semibold">Nomor Terdaftar:</span>
                  <span className={`font-mono font-bold truncate ${customerRegisteredPhone ? 'text-amber-300' : 'text-red-400'}`}>
                    {customerRegisteredPhone || '(Nomor kosong/tidak valid)'}
                  </span>
                </div>

                {/* Quick mode indicator / switch between Titip vs Transfer */}
                <div className="flex items-center gap-1 bg-neutral-900 p-0.5 rounded-lg border border-neutral-800">
                  <button
                    type="button"
                    onClick={() => handleToggleHoldTemplateType(true)}
                    className={`px-2 py-0.5 rounded text-[9px] font-bold cursor-pointer transition-all ${
                      !holdSpecialMode && holdIsTitip
                        ? 'bg-amber-500 text-black'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Dititipkan
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleHoldTemplateType(false)}
                    className={`px-2 py-0.5 rounded text-[9px] font-bold cursor-pointer transition-all ${
                      !holdSpecialMode && !holdIsTitip
                        ? 'bg-amber-500 text-black'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Tidak Dititipkan
                  </button>
                </div>
              </div>

              {/* Dedicated Dropdown for OH or Return (immediately triggers Web Share with photo & chosen text) */}
              <div className="flex items-center gap-2 text-[10px] pt-1 border-t border-neutral-800/80">
                <span className="text-sky-400 font-bold shrink-0">Kirim OH / Return:</span>
                <select
                  value=""
                  onChange={handleOhReturnDropdownChange}
                  disabled={photosCount === 0 || isSendingWa}
                  className="flex-1 min-w-0 bg-neutral-900 border border-sky-500/40 focus:border-sky-400 rounded-lg px-2 py-1 text-[10px] font-semibold text-sky-200 outline-none cursor-pointer disabled:opacity-50"
                >
                  <option value="">
                    {holdSpecialMode === 'oh'
                      ? 'OH terpilih (klik lagi untuk share ulang)'
                      : holdSpecialMode === 'return'
                        ? 'Return terpilih (klik lagi untuk share ulang)'
                        : '-- Pilih Template OH / Return (Langsung Web Share) --'}
                  </option>
                  <option value="oh">OH (On-Hold) — Langsung Web Share</option>
                  <option value="return">Return — Langsung Web Share</option>
                </select>
              </div>

              {!holdSpecialMode && holdIsTitip && (
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-neutral-400 shrink-0">Tempat Titip:</span>
                  <input
                    type="text"
                    value={holdTitipLocation}
                    onChange={(e) => {
                      const val = e.target.value;
                      setHoldTitipLocation(val);
                      setHoldTemplateText(buildHoldCameraTemplateText(cameraCustomer.name, true, val));
                    }}
                    placeholder="Nama tempat titip"
                    className="flex-1 min-w-0 bg-neutral-900 border border-neutral-800 focus:border-amber-500 rounded-lg px-2 py-1 text-[10px] text-amber-200 outline-none"
                  />
                  {tempatCodList.length > 0 && (
                    <select
                      value={tempatCodList.some(l => l.name === holdTitipLocation) ? holdTitipLocation : ''}
                      onChange={(e) => {
                        if (e.target.value) {
                          handleToggleHoldTemplateType(true, e.target.value);
                        }
                      }}
                      className="bg-neutral-900 border border-neutral-800 rounded-lg px-1.5 py-1 text-[10px] text-neutral-300 outline-none max-w-[120px]"
                    >
                      <option value="">Pilih...</option>
                      {tempatCodList.map(loc => (
                        <option key={loc.id} value={loc.name}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-[9px] font-bold uppercase tracking-wider ${
                    holdSpecialMode ? 'text-sky-400' : 'text-amber-400/90'
                  }`}>
                    Keterangan Template ({
                      holdSpecialMode === 'oh'
                        ? 'Laporan OH'
                        : holdSpecialMode === 'return'
                          ? 'Laporan Return'
                          : holdIsTitip
                            ? 'Paket Dititipkan'
                            : 'Tagihan Transfer'
                    }):
                  </span>
                </div>
                <textarea
                  value={holdTemplateText}
                  onChange={(e) => setHoldTemplateText(e.target.value)}
                  rows={3}
                  className="w-full bg-neutral-950 border border-neutral-800 focus:border-amber-500 rounded-lg px-2.5 py-1.5 text-[10px] text-neutral-200 leading-relaxed outline-none resize-none"
                />
              </div>
            </div>
          )}

          {/* Sending WA Business Target Bar */}
          {isSendingModule && (
            <div className="mt-2.5 px-3 py-1.5 rounded-xl bg-[#141416] border border-emerald-500/25 flex items-center justify-between gap-2 text-[10px]">
              <div className="min-w-0 truncate text-neutral-300">
                <span className="text-neutral-500 font-semibold">Tujuan WA Business: </span>
                {cleanedTarget ? (
                  <span className="text-emerald-400 font-mono font-bold">{cleanedTarget}</span>
                ) : (
                  <span className="text-amber-300 font-medium">Pilih chat di WA Business (otomatis)</span>
                )}
              </div>
              {onOpenSettingsFromCamera && (
                <button
                  type="button"
                  onClick={onOpenSettingsFromCamera}
                  className="text-[9px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 shrink-0 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 cursor-pointer"
                  title="Atur nomor tujuan WhatsApp Business di Pengaturan"
                >
                  <Settings className="w-2.5 h-2.5" />
                  {cleanedTarget ? 'Ubah' : 'Atur Nomor'}
                </button>
              )}
            </div>
          )}

          {sendFeedback && (
            <div className={`mt-2 px-3 py-1.5 rounded-xl border text-[10px] font-medium text-center space-y-1.5 ${
              isHoldModule
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
            }`}>
              <p>{sendFeedback}</p>
              {isSendingModule && lastSentMessageText && onSendTextToWaBusiness && (
                <button
                  type="button"
                  onClick={() => onSendTextToWaBusiness(lastSentMessageText)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white text-[9px] font-bold cursor-pointer transition-all"
                >
                  <Send className="w-2.5 h-2.5" />
                  Kirim Data Teks ke {cleanedTarget || 'WA Business'}
                </button>
              )}
              {isHoldModule && onOpenHoldCustomerWaChat && (
                <button
                  type="button"
                  onClick={() => {
                    const finalMessage =
                      lastSentMessageText ||
                      holdTemplateText.trim() ||
                      buildHoldCameraTemplateText(cameraCustomer.name, holdIsTitip, holdTitipLocation);
                    onOpenHoldCustomerWaChat(cameraCustomer, finalMessage);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-[9px] font-extrabold cursor-pointer transition-all"
                >
                  <Phone className="w-2.5 h-2.5" />
                  Buka Chat Nomor {customerRegisteredPhone || 'Buyer'}
                </button>
              )}
            </div>
          )}

          {/* Camera Shutter & Capture controls */}
          <div className="mt-3 flex flex-col items-center gap-2">
            <div className="flex items-center justify-center gap-3 sm:gap-4 w-full">
              
              {/* Fallback Live Camera Capture trigger */}
              <label 
                className="p-2.5 sm:p-3 rounded-full bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white border border-neutral-800 transition-all cursor-pointer flex items-center justify-center shrink-0"
                title="Ambil Foto Langsung"
              >
                <input 
                  type="file" 
                  accept="image/*" 
                  capture="environment" 
                  onChange={handleFallbackPhotoUpload} 
                  className="hidden"
                />
                <Camera className="w-4.5 h-4.5" />
              </label>

              {/* Dedicated Gallery Upload trigger */}
              <label 
                className="p-2.5 sm:p-3 rounded-full bg-neutral-900 hover:bg-neutral-800 text-[#C5A059] hover:text-[#D4AF37] border border-[#C5A059]/30 hover:border-[#C5A059]/60 transition-all cursor-pointer flex items-center justify-center relative group shrink-0"
                title="Pilih dari Galeri"
              >
                <input 
                  type="file" 
                  accept="image/*" 
                  multiple
                  onChange={handleGalleryUpload} 
                  className="hidden"
                  id="gallery-photo-upload"
                />
                <ImageIcon className="w-4.5 h-4.5" />
                <span className="absolute -top-7 left-1/2 transform -translate-x-1/2 bg-black text-[9px] text-white px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                  Pilih Galeri
                </span>
              </label>

              {/* Main Stream Capture Shutter button */}
              <button
                type="button"
                onClick={cameraStream ? capturePhoto : () => {
                  const fileInput = document.getElementById('gallery-photo-upload') as HTMLInputElement;
                  if (fileInput) fileInput.click();
                }}
                className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-gradient-to-tr from-[#C5A059] to-[#E9D5A6] p-[3px] shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-all cursor-pointer shrink-0"
                title="Tombol Shutter"
              >
                <div className="w-full h-full rounded-full bg-black flex items-center justify-center">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white" />
                </div>
              </button>

              {/* Send button: Sending module (WA Business) OR Hold module (customer registered number) */}
              {((isSendingModule && onSendCameraToWaBusiness) || (isHoldModule && onSendHoldCameraToCustomer)) && (
                <button
                  type="button"
                  onClick={handleTriggerSend}
                  disabled={photosCount === 0 || isSendingWa}
                  className={`px-3.5 py-2.5 disabled:bg-neutral-800 disabled:text-neutral-500 disabled:border-neutral-700 rounded-xl text-[11px] font-extrabold cursor-pointer disabled:cursor-not-allowed transition-all shadow-lg flex items-center gap-1.5 shrink-0 ${
                    isHoldModule
                      ? 'bg-amber-500 hover:bg-amber-400 text-black border border-amber-300/60 shadow-amber-950/40'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/40 shadow-emerald-950/50'
                  }`}
                  title={
                    photosCount === 0
                      ? 'Ambil / pilih foto terlebih dahulu'
                      : isHoldModule
                        ? 'Kirim Foto & Template Pesan ke Nomor Terdaftar Pelanggan'
                        : 'Kirim Foto, Nama, Alamat & Lokasi GPS ke WhatsApp Business'
                  }
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSendingWa ? 'Mengirim...' : isHoldModule ? 'Kirim' : 'Send'}</span>
                </button>
              )}

              {/* Done/Close trigger */}
              <button
                type="button"
                onClick={() => setCameraActiveForId(null)}
                className="px-3.5 py-2.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl text-neutral-400 hover:text-white text-[11px] font-bold cursor-pointer transition-all shrink-0"
              >
                Selesai
              </button>
            </div>
            
            <p className="text-[9px] text-neutral-500 text-center">
              {isHoldModule
                ? 'Ambil/pilih foto lalu tekan Kirim untuk mengirim foto & keterangan template ke nomor terdaftar.'
                : 'Ambil/pilih foto lalu tekan Send untuk mengirim foto, nama, alamat & lokasi GPS ke WhatsApp Business.'}
            </p>
          </div>

        </motion.div>
      )}
    </AnimatePresence>
  );
};

