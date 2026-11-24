import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  Copy,
  Check,
  Loader2,
  LogOut,
  QrCode,
  RefreshCw,
  Smartphone,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { WaGatewayState } from '../../types';

interface WAAutoConnectModalProps {
  show: boolean;
  onClose: () => void;
  gateway: WaGatewayState;
  onConnect: () => Promise<void>;
  onRequestPairingCode: (phone: string) => Promise<string | null>;
  onLogout: () => Promise<void>;
  onRefreshStatus: () => Promise<void>;
}

export const WAAutoConnectModal: React.FC<WAAutoConnectModalProps> = ({
  show,
  onClose,
  gateway,
  onConnect,
  onRequestPairingCode,
  onLogout,
  onRefreshStatus,
}) => {
  const [linkMode, setLinkMode] = useState<'qr' | 'pairing'>('qr');
  const [pairingPhone, setPairingPhone] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleTriggerConnect = async () => {
    setErrorMsg(null);
    setIsBusy(true);
    try {
      await onConnect();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal memulai koneksi WhatsApp.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pairingPhone.trim()) return;
    setErrorMsg(null);
    setIsBusy(true);
    try {
      await onRequestPairingCode(pairingPhone.trim());
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal meminta kode pairing.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleLogout = async () => {
    setErrorMsg(null);
    setIsBusy(true);
    try {
      await onLogout();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal memutus sesi WhatsApp.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleCopyPairingCode = () => {
    if (!gateway.pairingCode) return;
    navigator.clipboard?.writeText(gateway.pairingCode).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    });
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-3"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0, y: 10 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-[#0E0E11] border border-[#2A2A32] rounded-2xl p-4 shadow-2xl space-y-3.5 text-white"
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-neutral-800 pb-2.5">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#C5A059] flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5" />
                  KONEKSI WHATSAPP OTOMATIS (BAILEYS)
                </span>
                <p className="text-[11px] text-neutral-400 mt-0.5">
                  Untuk Kirim Otomatis modul Sending &amp; Kamera Paket Hold
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-full bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Connection Status Card */}
            <div className="p-3 rounded-xl bg-[#16161A] border border-[#25252B] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                    gateway.status === 'connected'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                      : gateway.status === 'connecting' || gateway.status === 'qr_ready'
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                      : 'bg-neutral-800 border-neutral-700 text-neutral-400'
                  }`}
                >
                  {gateway.status === 'connected' ? (
                    <Wifi className="w-4 h-4" />
                  ) : gateway.status === 'connecting' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : gateway.status === 'qr_ready' ? (
                    <QrCode className="w-4 h-4" />
                  ) : (
                    <WifiOff className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold flex items-center gap-1.5">
                    {gateway.status === 'connected'
                      ? 'WhatsApp Terhubung'
                      : gateway.status === 'qr_ready'
                      ? 'Siap Scan QR / Pairing'
                      : gateway.status === 'connecting'
                      ? 'Menghubungkan...'
                      : 'Belum Terhubung'}
                  </div>
                  <p className="text-[10px] text-neutral-400 truncate font-mono">
                    {gateway.status === 'connected' && gateway.user
                      ? `${gateway.user.name || 'WA'} (${gateway.user.phone}) • ${gateway.knownChatsCount} chat • ${gateway.knownSharelocCount ?? 0} loc • ${gateway.knownHousePhotoCount ?? 0} foto`
                      : `${gateway.knownChatsCount} chat • ${gateway.knownSharelocCount ?? 0} loc • ${gateway.knownHousePhotoCount ?? 0} foto`}
                  </p>
                </div>
              </div>

              <button
                onClick={() => void onRefreshStatus()}
                className="p-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white border border-neutral-800 cursor-pointer shrink-0"
                title="Refresh status koneksi"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {(errorMsg || gateway.lastError) && (
              <div className="p-2.5 rounded-xl bg-red-950/50 border border-red-800/50 text-red-300 text-[11px] leading-snug">
                {errorMsg || gateway.lastError}
              </div>
            )}

            {gateway.status === 'connected' ? (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-[11px] text-emerald-200 space-y-1.5 leading-relaxed">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    Siap Kirim Otomatis &amp; Cek Manual
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5 text-[10px] text-emerald-200/85">
                    <li>Jeda pengiriman otomatis 10–20 detik antar pesan.</li>
                    <li>Kartu yang ditandai <strong>Skip Manual</strong> otomatis dilompati.</li>
                    <li>Kirim otomatis mengecek riwayat chat &amp; shareloc customer.</li>
                    <li>Kirim manual mengecek shareloc &amp; foto rumah: jika lengkap &amp; Non-COD hanya buka chat; jika COD hanya kirim acuan COD tanpa minta shareloc.</li>
                  </ul>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={onClose}
                    className="flex-1 py-2.5 rounded-xl bg-[#C5A059] hover:bg-[#D4AF37] text-black font-extrabold text-xs cursor-pointer transition-all"
                  >
                    Tutup &amp; Lanjutkan
                  </button>
                  <button
                    onClick={handleLogout}
                    disabled={isBusy}
                    className="px-3 py-2.5 rounded-xl bg-red-950/50 hover:bg-red-900/60 text-red-300 border border-red-800/50 font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Putus
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Mode switcher */}
                <div className="grid grid-cols-2 gap-1 p-1 bg-[#16161A] rounded-xl border border-[#25252B]">
                  <button
                    type="button"
                    onClick={() => setLinkMode('qr')}
                    className={`py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      linkMode === 'qr'
                        ? 'bg-[#C5A059] text-black'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Scan QR Code
                  </button>
                  <button
                    type="button"
                    onClick={() => setLinkMode('pairing')}
                    className={`py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      linkMode === 'pairing'
                        ? 'bg-[#C5A059] text-black'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Kode Pairing (No HP)
                  </button>
                </div>

                {linkMode === 'qr' ? (
                  <div className="flex flex-col items-center space-y-2.5 p-3 bg-[#141418] rounded-xl border border-[#25252B]">
                    {gateway.qrDataUrl ? (
                      <>
                        <div className="p-2 bg-white rounded-xl shadow-lg">
                          <img
                            src={gateway.qrDataUrl}
                            alt="WhatsApp QR Code"
                            className="w-48 h-48 object-contain"
                          />
                        </div>
                        <p className="text-[10px] text-neutral-400 text-center leading-relaxed">
                          Buka WhatsApp di HP Anda &rarr; <strong className="text-neutral-200">Perangkat Tertaut</strong> &rarr; <strong className="text-neutral-200">Tautkan Perangkat</strong>, lalu scan QR di atas.
                        </p>
                      </>
                    ) : (
                      <div className="py-5 text-center space-y-3">
                        <p className="text-[11px] text-neutral-400 max-w-xs">
                          Klik tombol di bawah untuk memunculkan QR Code WhatsApp.
                        </p>
                        <button
                          type="button"
                          onClick={handleTriggerConnect}
                          disabled={isBusy || gateway.status === 'connecting'}
                          className="px-4 py-2 rounded-xl bg-[#C5A059] hover:bg-[#D4AF37] text-black font-extrabold text-xs inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          {isBusy || gateway.status === 'connecting' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <QrCode className="w-3.5 h-3.5" />
                          )}
                          Tampilkan QR Code
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <form
                    onSubmit={handleRequestCode}
                    className="space-y-2.5 p-3 bg-[#141418] rounded-xl border border-[#25252B]"
                  >
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-300">
                      Nomor WhatsApp Kurir Anda:
                    </label>
                    <input
                      type="tel"
                      value={pairingPhone}
                      onChange={(e) => setPairingPhone(e.target.value)}
                      placeholder="Contoh: 081234567890"
                      className="w-full px-3 py-2 rounded-xl bg-black border border-neutral-800 focus:border-[#C5A059] outline-none text-xs font-mono text-white"
                    />
                    <button
                      type="submit"
                      disabled={isBusy || !pairingPhone.trim()}
                      className="w-full py-2 rounded-xl bg-[#C5A059] hover:bg-[#D4AF37] disabled:opacity-40 text-black font-extrabold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      Minta Kode Pairing 8 Digit
                    </button>

                    {gateway.pairingCode && (
                      <div className="mt-2 p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-center space-y-1.5">
                        <span className="text-[10px] text-emerald-300 font-bold uppercase">
                          Kode Pairing Anda:
                        </span>
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-lg font-black tracking-[0.2em] font-mono text-white">
                            {gateway.pairingCode}
                          </span>
                          <button
                            type="button"
                            onClick={handleCopyPairingCode}
                            className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-300 hover:text-white cursor-pointer"
                            title="Salin kode"
                          >
                            {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <p className="text-[10px] text-neutral-400 leading-snug">
                          Di HP Anda: WhatsApp &rarr; Perangkat Tertaut &rarr; Tautkan Perangkat &rarr; <strong className="text-neutral-200">Tautkan dengan nomor telepon</strong>.
                        </p>
                      </div>
                    )}
                  </form>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
