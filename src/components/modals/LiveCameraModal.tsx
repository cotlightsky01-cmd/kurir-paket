import React, { useState, useEffect } from 'react';
import {
  Camera,
  X,
  Upload,
  Image as ImageIcon,
  Send,
  Check,
  Settings,
  MapPin,
  Loader2,
  Phone,
  Wifi,
  WifiOff,
  Users,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Customer,
  HoldGroupResolvedItem,
  TempatCodLocation,
  WaConnectionStatus,
} from '../../types';
import {
  cleanPhoneNumber,
  buildHoldCameraTemplateText,
} from '../../utils/helpers';
import { HOLD_ON_HOLD_GROUP_OPTIONS } from '../../utils/holdGroups';

export interface SendingCameraSendResult {
  ok: boolean;
  method: 'baileys_direct' | 'missing_target' | 'not_connected' | 'error';
  messageText?: string;
  sentToPhone?: string;
  error?: string;
}

export interface HoldCameraSendResult {
  ok: boolean;
  method:
    | 'baileys_dual'
    | 'invalid_phone'
    | 'missing_group'
    | 'not_connected'
    | 'partial_error'
    | 'error';
  buyerSent?: boolean;
  groupSent?: boolean;
  sentToPhone?: string;
  groupLabel?: string;
  error?: string;
}

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
  waGatewayStatus?: WaConnectionStatus;
  tempatCodList?: TempatCodLocation[];
  holdGroupOptions?: HoldGroupResolvedItem[];
  selectedHoldGroupUrl?: string;
  onSelectHoldGroupUrl?: (url: string) => void;
  onSendCameraToWaBusiness?: (
    customer: Customer,
    photoUrl: string,
    gpsUrl?: string | null
  ) => Promise<SendingCameraSendResult>;
  onSendHoldCameraBundle?: (
    customer: Customer,
    photoUrl: string,
    templateCaption: string,
    ohReturnType: 'oh' | 'return',
    groupUrl: string
  ) => Promise<HoldCameraSendResult>;
  onOpenWaConnectModal?: () => void;
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
  waGatewayStatus = 'disconnected',
  tempatCodList = [],
  holdGroupOptions,
  selectedHoldGroupUrl,
  onSelectHoldGroupUrl,
  onSendCameraToWaBusiness,
  onSendHoldCameraBundle,
  onOpenWaConnectModal,
  onOpenSettingsFromCamera,
}) => {
  const isSendingModule = cameraCustomer?.status === 'modul1';
  const isHoldModule = cameraCustomer?.status === 'modul3';
  const activePhotos = isSendingModule ? sessionPhotos || [] : cameraCustomer?.photos || [];
  const photosCount = activePhotos.length;
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState<number>(0);
  const [isSendingWa, setIsSendingWa] = useState(false);
  const [sendFeedback, setSendFeedback] = useState<string | null>(null);
  const [sendFailureReason, setSendFailureReason] = useState<
    'missing_target' | 'not_connected' | 'invalid_phone' | 'partial_error' | 'error' | null
  >(null);

  // Hold template state (Message 1 -> Registered Buyer Phone)
  const [holdIsTitip, setHoldIsTitip] = useState<boolean>(false);
  const [holdTitipLocation, setHoldTitipLocation] = useState<string>('');
  const [holdTemplateText, setHoldTemplateText] = useState<string>('');

  // Hold group state (Message 2 -> Selected On Hold Group with "oh" or "return")
  const [holdOhReturnType, setHoldOhReturnType] = useState<'oh' | 'return'>('oh');
  const [localHoldGroupUrl, setLocalHoldGroupUrl] = useState<string>(
    HOLD_ON_HOLD_GROUP_OPTIONS[0].url
  );

  const resolvedGroupList: HoldGroupResolvedItem[] =
    holdGroupOptions && holdGroupOptions.length > 0
      ? holdGroupOptions
      : HOLD_ON_HOLD_GROUP_OPTIONS.map((g) => ({
          ...g,
          subject: null,
          jid: null,
          resolved: false,
        }));

  const activeHoldGroupUrl = selectedHoldGroupUrl || localHoldGroupUrl;
  const activeHoldGroup =
    resolvedGroupList.find((g) => g.url === activeHoldGroupUrl) || resolvedGroupList[0];

  // Reset template mode when camera opens/switches customer
  useEffect(() => {
    if (!cameraCustomer || cameraCustomer.status !== 'modul3') {
      setHoldIsTitip(false);
      setHoldTitipLocation('');
      setHoldTemplateText('');
      return;
    }

    const wasTitipSelected =
      cameraCustomer.waLastTemplateType === 'titip' && Boolean(cameraCustomer.titipLocationName);
    const defaultLoc =
      cameraCustomer.titipLocationName || tempatCodList[0]?.name || 'tempat titip';

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
    setSendFailureReason(null);
  }, [cameraActiveForId, photosCount]);

  const cleanedTarget = waReportNumber.trim() ? cleanPhoneNumber(waReportNumber.trim()) : '';
  const customerRegisteredPhone = cameraCustomer
    ? cameraCustomer.cleanPhone || cleanPhoneNumber(cameraCustomer.phone || '')
    : '';

  const handleToggleHoldTemplateType = (useTitip: boolean, locOverride?: string) => {
    if (!cameraCustomer) return;
    const nextLoc = locOverride ?? holdTitipLocation ?? tempatCodList[0]?.name ?? 'tempat titip';
    setHoldIsTitip(useTitip);
    setHoldTitipLocation(nextLoc);
    setHoldTemplateText(buildHoldCameraTemplateText(cameraCustomer.name, useTitip, nextLoc));
  };

  const handleSelectGroupChange = (url: string) => {
    setLocalHoldGroupUrl(url);
    if (onSelectHoldGroupUrl) {
      onSelectHoldGroupUrl(url);
    }
  };

  const handleTriggerSend = async () => {
    if (!cameraCustomer || photosCount === 0 || isSendingWa) return;

    const safeIdx = Math.min(Math.max(0, selectedPhotoIdx), photosCount - 1);
    const selectedPhotoUrl = activePhotos[safeIdx];

    if (isHoldModule && onSendHoldCameraBundle) {
      setIsSendingWa(true);
      setSendFeedback(null);
      setSendFailureReason(null);
      try {
        const finalTemplate =
          holdTemplateText.trim() ||
          buildHoldCameraTemplateText(cameraCustomer.name, holdIsTitip, holdTitipLocation);

        const result = await onSendHoldCameraBundle(
          cameraCustomer,
          selectedPhotoUrl,
          finalTemplate,
          holdOhReturnType,
          activeHoldGroupUrl
        );

        if (result.ok && result.method === 'baileys_dual') {
          setSendFailureReason(null);
          const groupDisplay =
            result.groupLabel || activeHoldGroup?.subject || activeHoldGroup?.label || 'Grup On Hold';
          setSendFeedback(
            `Berhasil! 2 pesan terkirim otomatis: (1) Foto & template ke ${
              result.sentToPhone || customerRegisteredPhone
            }, (2) Foto & "${holdOhReturnType}" ke grup "${groupDisplay}".`
          );
        } else if (result.method === 'not_connected') {
          setSendFailureReason('not_connected');
          setSendFeedback(
            result.error ||
              'WhatsApp belum terhubung. Hubungkan WA terlebih dahulu untuk kirim otomatis.'
          );
        } else if (result.method === 'invalid_phone') {
          setSendFailureReason('invalid_phone');
          setSendFeedback(
            result.error || 'Nomor terdaftar pelanggan kosong atau tidak valid untuk WhatsApp.'
          );
        } else if (result.method === 'partial_error') {
          setSendFailureReason('partial_error');
          setSendFeedback(
            result.error ||
              'Pesan ke nomor terdaftar terkirim, namun gagal mengirim ke grup On Hold.'
          );
        } else {
          setSendFailureReason('error');
          setSendFeedback(result.error || 'Gagal mengirim 2 pesan Hold otomatis.');
        }
      } finally {
        setIsSendingWa(false);
      }
      return;
    }

    if (isSendingModule && onSendCameraToWaBusiness) {
      setIsSendingWa(true);
      setSendFeedback(null);
      setSendFailureReason(null);
      try {
        const result = await onSendCameraToWaBusiness(
          cameraCustomer,
          selectedPhotoUrl,
          sessionLocationUrl
        );
        if (result.ok && result.method === 'baileys_direct') {
          setSendFailureReason(null);
          setSendFeedback(
            `Foto & data (Nama, Alamat, GPS) berhasil dikirim otomatis ke ${
              result.sentToPhone || cleanedTarget
            }!`
          );
        } else if (result.method === 'missing_target') {
          setSendFailureReason('missing_target');
          setSendFeedback(
            result.error ||
              'Nomor tujuan WhatsApp belum diatur. Silakan atur nomor tujuan terlebih dahulu.'
          );
        } else if (result.method === 'not_connected') {
          setSendFailureReason('not_connected');
          setSendFeedback(
            result.error ||
              'WhatsApp belum terhubung. Hubungkan WA terlebih dahulu untuk kirim otomatis.'
          );
        } else {
          setSendFailureReason('error');
          setSendFeedback(result.error || 'Gagal mengirim pesan otomatis ke nomor tujuan.');
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
          <div className="flex justify-between items-center mb-2.5 shrink-0">
            <div className="min-w-0 pr-2">
              {isHoldModule ? (
                <>
                  <span className="text-[10px] tracking-widest uppercase text-amber-500 font-extrabold flex items-center gap-1">
                    <Camera className="w-3.5 h-3.5" /> KAMERA PAKET HOLD (KIRIM OTOMATIS)
                  </span>
                  <p className="text-[9px] text-amber-400/80 font-medium">
                    Kirim otomatis 2 pesan: template ke nomor terdaftar + OH/Return ke grup On Hold.
                  </p>
                </>
              ) : (
                <>
                  <span className="text-[10px] tracking-widest uppercase text-emerald-400 font-extrabold flex items-center gap-1">
                    <Camera className="w-3.5 h-3.5" /> KAMERA KIRIM OTOMATIS (+ LOKASI GPS)
                  </span>
                  <p className="text-[9px] text-emerald-400/80 font-medium">
                    Foto, nama, alamat &amp; GPS dikirim otomatis ke nomor tujuan (tidak disimpan
                    permanen).
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
          <div className="flex-1 bg-black rounded-2xl border border-neutral-800 relative overflow-hidden flex items-center justify-center min-h-[110px]">
            {!cameraError ? (
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            ) : (
              <div className="p-4 text-center space-y-2">
                <div className="w-9 h-9 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto border border-amber-500/20">
                  <Upload className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[11px] font-bold text-neutral-300">
                    Akses Kamera Iframe Terbatas
                  </p>
                  <p className="text-[9px] text-neutral-500 max-w-[220px] mx-auto mt-1 leading-normal">
                    Gunakan tombol <span className="text-white font-semibold">Kamera</span> di
                    bawah untuk foto langsung, atau tombol{' '}
                    <span className="text-[#C5A059] font-semibold">Galeri</span> untuk memilih foto
                    dari galeri HP.
                  </p>
                </div>
              </div>
            )}

            {/* Photo overlay counts */}
            <span
              className={`absolute top-2.5 left-2.5 bg-black/80 text-[10px] font-bold px-2.5 py-1 rounded-full border shadow-md ${
                isHoldModule
                  ? 'text-amber-400 border-amber-500/40'
                  : 'text-emerald-400 border-emerald-500/40'
              }`}
            >
              {isHoldModule
                ? `${photosCount} Tersimpan (Sementara)`
                : `${photosCount} Foto Siap Kirim (Sementara)`}
            </span>

            {/* GPS status badge for Sending module */}
            {isSendingModule && (
              <div
                className={`absolute top-2.5 right-2.5 bg-black/80 text-[10px] font-bold px-2.5 py-1 rounded-full border shadow-md flex items-center gap-1 ${
                  sessionLocationUrl
                    ? 'text-emerald-400 border-emerald-500/40'
                    : isFetchingSessionGps
                      ? 'text-amber-300 border-amber-500/40'
                      : 'text-neutral-300 border-neutral-700'
                }`}
              >
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
            <div className="mt-2 shrink-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-bold text-neutral-500 tracking-wider">
                  HASIL CAPTURE (Ketuk untuk pilih foto dikirim):
                </span>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 scrollbar-none">
                {activePhotos.map((ph, index) => {
                  const isSelected = index === Math.min(selectedPhotoIdx, photosCount - 1);
                  return (
                    <div
                      key={`cam_ph_${cameraCustomer.id}_${index}`}
                      onClick={() => setSelectedPhotoIdx(index)}
                      className={`w-11 h-11 rounded-lg overflow-hidden shrink-0 relative group cursor-pointer transition-all ${
                        isSelected
                          ? isHoldModule
                            ? 'ring-2 ring-amber-400 border border-amber-400'
                            : 'ring-2 ring-emerald-400 border border-emerald-400'
                          : 'border border-neutral-800'
                      }`}
                    >
                      <img
                        src={ph}
                        alt=""
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                      {isSelected && (
                        <span
                          className={`absolute bottom-0.5 left-0.5 w-3.5 h-3.5 rounded-full text-black flex items-center justify-center ${
                            isHoldModule ? 'bg-amber-400' : 'bg-emerald-500'
                          }`}
                        >
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

          {/* Hold Module: Dual Auto-Send Configuration (Message 1 Buyer Template + Message 2 On Hold Group) */}
          {isHoldModule && (
            <div className="mt-2 p-2.5 rounded-xl bg-[#141416] border border-amber-500/30 space-y-2 max-h-[45vh] overflow-y-auto scrollbar-none shrink-0">
              {/* Top row: Buyer Phone + WA Gateway Status */}
              <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Phone className="w-3 h-3 text-amber-400 shrink-0" />
                  <span className="text-neutral-400 font-semibold">No. Terdaftar:</span>
                  <span
                    className={`font-mono font-bold truncate ${
                      customerRegisteredPhone ? 'text-amber-300' : 'text-red-400'
                    }`}
                  >
                    {customerRegisteredPhone || '(Kosong/Invalid)'}
                  </span>
                </div>

                {onOpenWaConnectModal && (
                  <button
                    type="button"
                    onClick={onOpenWaConnectModal}
                    className={`text-[9px] font-bold flex items-center gap-1 px-2 py-0.5 rounded border cursor-pointer shrink-0 ${
                      waGatewayStatus === 'connected'
                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
                        : 'bg-amber-500/15 text-amber-300 border-amber-500/35 hover:bg-amber-500/25'
                    }`}
                    title="Status koneksi WhatsApp untuk kirim otomatis"
                  >
                    {waGatewayStatus === 'connected' ? (
                      <>
                        <Wifi className="w-2.5 h-2.5" />
                        <span>WA Aktif</span>
                      </>
                    ) : (
                      <>
                        <WifiOff className="w-2.5 h-2.5" />
                        <span>Hubungkan WA</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {activePhotos.length > 0 && (
                <>
                  {/* Message 1 Template Mode (Dititipkan vs Tidak Dititipkan) */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-neutral-800/80">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400/90">
                      Pesan 1 → Nomor Terdaftar (
                      {holdIsTitip ? 'Paket Dititipkan' : 'Tagihan Transfer'}):
                    </span>
                    <div className="flex items-center gap-1 bg-neutral-900 p-0.5 rounded-lg border border-neutral-800">
                      <button
                        type="button"
                        onClick={() => handleToggleHoldTemplateType(true)}
                        className={`px-2 py-0.5 rounded text-[9px] font-bold cursor-pointer transition-all ${
                          holdIsTitip
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
                          !holdIsTitip
                            ? 'bg-amber-500 text-black'
                            : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        Tidak Dititipkan
                      </button>
                    </div>
                  </div>

                  {holdIsTitip && (
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <span className="text-neutral-400 shrink-0">Tempat Titip:</span>
                      <input
                        type="text"
                        value={holdTitipLocation}
                        onChange={(e) => {
                          const val = e.target.value;
                          setHoldTitipLocation(val);
                          setHoldTemplateText(
                            buildHoldCameraTemplateText(cameraCustomer.name, true, val)
                          );
                        }}
                        placeholder="Nama tempat titip"
                        className="flex-1 min-w-0 bg-neutral-900 border border-neutral-800 focus:border-amber-500 rounded-lg px-2 py-1 text-[10px] text-amber-200 outline-none"
                      />
                      {tempatCodList.length > 0 && (
                        <select
                          value={
                            tempatCodList.some((l) => l.name === holdTitipLocation)
                              ? holdTitipLocation
                              : ''
                          }
                          onChange={(e) => {
                            if (e.target.value) {
                              handleToggleHoldTemplateType(true, e.target.value);
                            }
                          }}
                          className="bg-neutral-900 border border-neutral-800 rounded-lg px-1.5 py-1 text-[10px] text-neutral-300 outline-none max-w-[115px]"
                        >
                          <option value="">Pilih...</option>
                          {tempatCodList.map((loc) => (
                            <option key={loc.id} value={loc.name}>
                              {loc.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  <textarea
                    value={holdTemplateText}
                    onChange={(e) => setHoldTemplateText(e.target.value)}
                    rows={2}
                    className="w-full bg-neutral-950 border border-neutral-800 focus:border-amber-500 rounded-lg px-2.5 py-1.5 text-[10px] text-neutral-200 leading-relaxed outline-none resize-none"
                  />

                  {/* Message 2 Configuration: OH / Return + 5 Grup On Hold Dropdown */}
                  <div className="pt-1.5 border-t border-neutral-800/80 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-sky-400">
                      <Users className="w-3 h-3 shrink-0" />
                      <span>Pesan 2 → Grup On Hold (Keterangan OH / Return):</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-1.5 text-[10px]">
                      <div className="sm:col-span-4">
                        <select
                          value={holdOhReturnType}
                          onChange={(e) =>
                            setHoldOhReturnType(e.target.value === 'return' ? 'return' : 'oh')
                          }
                          disabled={isSendingWa}
                          aria-label="Keterangan OH atau Return"
                          className="w-full bg-neutral-900 border border-sky-500/40 focus:border-sky-400 rounded-lg px-2 py-1.5 text-[10px] font-bold text-sky-200 outline-none cursor-pointer disabled:opacity-50"
                        >
                          <option value="oh">Keterangan: OH</option>
                          <option value="return">Keterangan: Return</option>
                        </select>
                      </div>

                      <div className="sm:col-span-8">
                        <select
                          value={activeHoldGroupUrl}
                          onChange={(e) => handleSelectGroupChange(e.target.value)}
                          disabled={isSendingWa}
                          aria-label="Pilih Grup On Hold"
                          className="w-full bg-neutral-900 border border-sky-500/40 focus:border-sky-400 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-white outline-none cursor-pointer disabled:opacity-50"
                        >
                          {resolvedGroupList.map((group, idx) => (
                            <option key={group.id} value={group.url}>
                              {`${idx + 1}. ${group.subject || group.label}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {activeHoldGroup && (
                      <p className="text-[9px] text-sky-300/90 truncate font-medium">
                        Grup terpilih:{' '}
                        <span className="font-bold text-white">
                          {activeHoldGroup.subject || activeHoldGroup.label}
                        </span>
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Sending Direct Target & WA Connection Bar */}
          {isSendingModule && (
            <div className="mt-2.5 px-3 py-1.5 rounded-xl bg-[#141416] border border-emerald-500/25 flex items-center justify-between gap-2 text-[10px] shrink-0">
              <div className="min-w-0 truncate text-neutral-300 flex items-center gap-1.5">
                <span className="text-neutral-500 font-semibold">Tujuan:</span>
                {cleanedTarget ? (
                  <span className="text-emerald-400 font-mono font-bold truncate">
                    {cleanedTarget}
                  </span>
                ) : (
                  <span className="text-amber-300 font-medium">Belum diatur</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {onOpenWaConnectModal && (
                  <button
                    type="button"
                    onClick={onOpenWaConnectModal}
                    className={`text-[9px] font-bold flex items-center gap-1 px-2 py-0.5 rounded border cursor-pointer ${
                      waGatewayStatus === 'connected'
                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
                        : 'bg-amber-500/15 text-amber-300 border-amber-500/35 hover:bg-amber-500/25'
                    }`}
                    title="Status koneksi WhatsApp untuk kirim otomatis"
                  >
                    {waGatewayStatus === 'connected' ? (
                      <>
                        <Wifi className="w-2.5 h-2.5" />
                        <span>WA Aktif</span>
                      </>
                    ) : (
                      <>
                        <WifiOff className="w-2.5 h-2.5" />
                        <span>Hubungkan WA</span>
                      </>
                    )}
                  </button>
                )}
                {onOpenSettingsFromCamera && (
                  <button
                    type="button"
                    onClick={onOpenSettingsFromCamera}
                    className="text-[9px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 cursor-pointer"
                    title="Atur nomor tujuan WhatsApp di Pengaturan"
                  >
                    <Settings className="w-2.5 h-2.5" />
                    {cleanedTarget ? 'Ubah' : 'Atur Nomor'}
                  </button>
                )}
              </div>
            </div>
          )}

          {sendFeedback && (
            <div
              className={`mt-2 px-3 py-1.5 rounded-xl border text-[10px] font-medium text-center space-y-1.5 shrink-0 ${
                sendFailureReason
                  ? 'bg-red-500/15 border-red-500/40 text-red-200'
                  : isHoldModule
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                    : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
              }`}
            >
              <p>{sendFeedback}</p>
              {isSendingModule &&
                sendFailureReason === 'missing_target' &&
                onOpenSettingsFromCamera && (
                  <button
                    type="button"
                    onClick={onOpenSettingsFromCamera}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-[9px] font-extrabold cursor-pointer transition-all"
                  >
                    <Settings className="w-2.5 h-2.5" />
                    Atur Nomor Tujuan
                  </button>
                )}
              {sendFailureReason === 'not_connected' && onOpenWaConnectModal && (
                <button
                  type="button"
                  onClick={onOpenWaConnectModal}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#C5A059] hover:bg-[#D4AF37] text-black text-[9px] font-extrabold cursor-pointer transition-all"
                >
                  <Wifi className="w-2.5 h-2.5" />
                  Hubungkan WA Sekarang
                </button>
              )}
            </div>
          )}

          {/* Camera Shutter & Capture controls */}
          <div className="mt-2.5 flex flex-col items-center gap-1.5 shrink-0">
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
                onClick={
                  cameraStream
                    ? capturePhoto
                    : () => {
                        const fileInput = document.getElementById(
                          'gallery-photo-upload'
                        ) as HTMLInputElement;
                        if (fileInput) fileInput.click();
                      }
                }
                className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-gradient-to-tr from-[#C5A059] to-[#E9D5A6] p-[3px] shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-all cursor-pointer shrink-0"
                title="Tombol Shutter"
              >
                <div className="w-full h-full rounded-full bg-black flex items-center justify-center">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white" />
                </div>
              </button>

              {/* Send button: Sending module (direct WA) OR Hold module (dual auto-send: Buyer + Group) */}
              {((isSendingModule && onSendCameraToWaBusiness) ||
                (isHoldModule && onSendHoldCameraBundle)) && (
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
                        ? 'Kirim otomatis 2 pesan: template ke nomor terdaftar + OH/Return ke grup On Hold'
                        : 'Kirim Otomatis Foto, Nama, Alamat & Lokasi GPS ke Nomor Tujuan'
                  }
                >
                  {isSendingWa ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isSendingWa
                      ? isHoldModule
                        ? 'Mengirim 2 Pesan...'
                        : 'Mengirim...'
                      : 'Send'}
                  </span>
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
                ? 'Ambil/pilih foto lalu tekan Send untuk otomatis kirim template ke nomor terdaftar & OH/Return ke grup On Hold.'
                : 'Ambil/pilih foto lalu tekan Send untuk mengirim otomatis foto, nama, alamat & lokasi GPS ke nomor tujuan.'}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
