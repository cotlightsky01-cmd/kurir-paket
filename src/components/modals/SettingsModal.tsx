import React from 'react';
import { Settings, X, MapPin, Plus, RotateCcw, Sparkles, Trash2, Archive, RefreshCw, Phone } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Customer, TempatCodLocation } from '../../types';
import { cleanPhoneNumber } from '../../utils/helpers';

interface SettingsModalProps {
  showSettingsInsidePhone: boolean;
  setShowSettingsInsidePhone: (show: boolean) => void;
  msgTemplateCod: string;
  setMsgTemplateCod: (val: string) => void;
  msgTemplateNoCod: string;
  setMsgTemplateNoCod: (val: string) => void;
  msgTemplateTitip: string;
  setMsgTemplateTitip: (val: string) => void;
  msgTemplateAutoCodOnly?: string;
  setMsgTemplateAutoCodOnly?: (val: string) => void;
  msgTemplateOh?: string;
  setMsgTemplateOh?: (val: string) => void;
  msgTemplateReturn?: string;
  setMsgTemplateReturn?: (val: string) => void;
  tempatCodList: TempatCodLocation[];
  handleResetDefaultLocations: () => void;
  handleDeleteLocation: (id: string) => void;
  handleUpdateLocationAddress: (id: string, targetAddress: string) => void;
  newLocationName: string;
  setNewLocationName: (val: string) => void;
  newLocationAddress: string;
  setNewLocationAddress: (val: string) => void;
  handleAddLocation: () => void;
  setShowResetModal: (show: boolean) => void;
  loadSampleData: () => void;
  clearAllData: () => void;
  customers: Customer[];
  // Archive props
  handleRunAutoArchiveNow: () => Promise<void>;
  setShowArchiveModal: (show: boolean) => void;
  archivedCount: number;
  isArchiving: boolean;
  // WhatsApp Target App
  waTargetApp?: 'business' | 'regular';
  toggleWaTargetApp?: () => void;
  waReportNumber?: string;
  setWaReportNumber?: (val: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  showSettingsInsidePhone,
  setShowSettingsInsidePhone,
  msgTemplateCod,
  setMsgTemplateCod,
  msgTemplateNoCod,
  setMsgTemplateNoCod,
  msgTemplateTitip,
  setMsgTemplateTitip,
  msgTemplateAutoCodOnly = '',
  setMsgTemplateAutoCodOnly,
  msgTemplateOh = '',
  setMsgTemplateOh,
  msgTemplateReturn = '',
  setMsgTemplateReturn,
  tempatCodList,
  handleResetDefaultLocations,
  handleDeleteLocation,
  handleUpdateLocationAddress,
  newLocationName,
  setNewLocationName,
  newLocationAddress,
  setNewLocationAddress,
  handleAddLocation,
  setShowResetModal,
  loadSampleData,
  clearAllData,
  customers,
  // Archive props
  handleRunAutoArchiveNow,
  setShowArchiveModal,
  archivedCount,
  isArchiving,
  waTargetApp = 'business',
  toggleWaTargetApp,
  waReportNumber = '',
  setWaReportNumber,
}) => {
  return (
    <AnimatePresence>
      {showSettingsInsidePhone && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="fixed inset-2 sm:inset-10 md:inset-x-20 lg:inset-x-32 xl:inset-x-60 top-4 bottom-4 bg-[#0B0B0C]/98 border border-[#2A2A30] rounded-2xl z-50 flex flex-col overflow-hidden p-4 shadow-2xl"
        >
          {/* Settings Header */}
          <div className="flex justify-between items-center mb-4 border-b border-neutral-800 pb-3">
            <div>
              <span className="text-[10px] tracking-widest uppercase text-[#D4AF37] font-extrabold flex items-center gap-1">
                <Settings className="w-3.5 h-3.5 text-[#C5A059]" /> CONFIGURATION
              </span>
              <h4 className="text-xs font-bold text-white mt-0.5">
                Templates, Pengaturan Arsip &amp; Data
              </h4>
            </div>
            <button 
              onClick={() => setShowSettingsInsidePhone(false)}
              className="p-1.5 rounded-full bg-neutral-955 text-neutral-400 hover:text-white border border-neutral-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable Configuration Fields */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-none text-xs text-neutral-300">
            
            {/* WhatsApp Target App Setting */}
            <div className="p-3 bg-[#141416] border border-[#232328] rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h5 className="text-xs font-bold text-white uppercase tracking-wider">
                    Aplikasi WhatsApp Tujuan
                  </h5>
                  <p className="text-[10px] text-neutral-400">
                    Arahkan pengiriman pesan otomatis ke WhatsApp Business atau WA Biasa
                  </p>
                </div>
                {toggleWaTargetApp && (
                  <button
                    onClick={toggleWaTargetApp}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      (waTargetApp || 'business') === 'business'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-neutral-800 text-neutral-300 border border-neutral-700'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    {(waTargetApp || 'business') === 'business' ? 'WA Business' : 'WA Regular'}
                  </button>
                )}
              </div>

              {setWaReportNumber && (
                <div className="pt-2.5 border-t border-neutral-800/80 space-y-1.5">
                  <label className="block font-bold text-emerald-400 text-[10px] tracking-wider uppercase flex items-center gap-1.5">
                    <Phone className="w-3 h-3" />
                    Nomor WA Business Tujuan (Tombol Send Kamera Sending):
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type="tel"
                      value={waReportNumber}
                      onChange={(e) => setWaReportNumber(e.target.value)}
                      placeholder="Contoh: 081234567890"
                      className="w-full px-3 py-2 pr-8 rounded-xl bg-neutral-900 border border-neutral-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all text-white font-mono text-xs placeholder-neutral-600"
                    />
                    {waReportNumber && (
                      <button
                        type="button"
                        onClick={() => setWaReportNumber('')}
                        className="absolute right-2.5 p-1 rounded-full text-neutral-500 hover:text-white cursor-pointer"
                        title="Hapus nomor tujuan"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-neutral-400 leading-snug">
                    {waReportNumber.trim() ? (
                      <>
                        Otomatis kirim foto, nama &amp; alamat ke:{' '}
                        <span className="text-emerald-400 font-mono font-bold">
                          {cleanPhoneNumber(waReportNumber.trim())}
                        </span>
                      </>
                    ) : (
                      'Isi nomor WA Business tujuan agar tombol Send pada kamera Sending langsung membuka chat nomor tersebut. Jika kosong, akan membuka pemilih chat WA Business.'
                    )}
                  </p>
                </div>
              )}
            </div>

            {/* Auto-Archive Section */}
            <div className="p-3 bg-[#141416] border border-[#232328] rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <Archive className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-white uppercase tracking-wider">
                      Arsip Data Otomatis (&gt;3 Hari)
                    </h5>
                    <p className="text-[10px] text-neutral-400">
                      Otomatis memindahkan paket selesai &gt;3 hari ke Arsip agar aplikasi tetap ringan
                    </p>
                  </div>
                </div>

                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                  AKTIF
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-neutral-800/80">
                <button
                  onClick={handleRunAutoArchiveNow}
                  disabled={isArchiving}
                  className="py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isArchiving ? 'animate-spin' : ''}`} />
                  {isArchiving ? 'Memproses Arsip...' : 'Arsip Paket >3 Hari Sekarang'}
                </button>

                <button
                  onClick={() => {
                    setShowSettingsInsidePhone(false);
                    setShowArchiveModal(true);
                  }}
                  className="py-2 px-3 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-emerald-400 border border-emerald-500/30 font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Archive className="w-3.5 h-3.5" />
                  Lihat Semua Arsip ({archivedCount})
                </button>
              </div>
            </div>

            {/* Template COD */}
            <div>
              <label className="block font-bold text-[#C5A059] text-[10px] tracking-wider uppercase mb-1.5">
                Template Paket COD Standar:
              </label>
              <textarea 
                value={msgTemplateCod}
                onChange={(e) => setMsgTemplateCod(e.target.value)}
                rows={2}
                className="w-full p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 focus:border-[#C5A059] focus:ring-1 focus:ring-[#C5A059] outline-none transition-all resize-none text-white text-[11px] leading-relaxed"
                placeholder="Template pesan COD..."
              />
            </div>

            {/* Template Non-COD */}
            <div>
              <label className="block font-bold text-[#C5A059] text-[10px] tracking-wider uppercase mb-1.5">
                Template Paket Non-COD / NO COD:
              </label>
              <textarea 
                value={msgTemplateNoCod}
                onChange={(e) => setMsgTemplateNoCod(e.target.value)}
                rows={2}
                className="w-full p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 focus:border-[#C5A059] focus:ring-1 focus:ring-[#C5A059] outline-none transition-all resize-none text-white text-[11px] leading-relaxed"
                placeholder="Template pesan Non-COD..."
              />
            </div>

            {/* Template Titip Paket COD */}
            <div>
              <label className="block font-bold text-[#C5A059] text-[10px] tracking-wider uppercase mb-1.5">
                Template Titip Paket COD:
              </label>
              <textarea 
                value={msgTemplateTitip}
                onChange={(e) => setMsgTemplateTitip(e.target.value)}
                rows={2}
                className="w-full p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 focus:border-[#C5A059] focus:ring-1 focus:ring-[#C5A059] outline-none transition-all resize-none text-white text-[11px] leading-relaxed"
                placeholder="Template pesan Titip COD..."
              />
            </div>

            {/* Template Otomatis COD Saja (Sudah Pernah Chat, Tanpa Shareloc) */}
            {setMsgTemplateAutoCodOnly && (
              <div>
                <label className="block font-bold text-emerald-400 text-[10px] tracking-wider uppercase mb-1.5">
                  Template Otomatis COD (Sudah Pernah Chat — Tanpa Shareloc):
                </label>
                <textarea 
                  value={msgTemplateAutoCodOnly}
                  onChange={(e) => setMsgTemplateAutoCodOnly(e.target.value)}
                  rows={2}
                  className="w-full p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all resize-none text-white text-[11px] leading-relaxed"
                  placeholder="Template info nominal COD saja tanpa meminta shareloc..."
                />
              </div>
            )}

            {/* Template OH & Return (Kamera Sending) */}
            {setMsgTemplateOh && setMsgTemplateReturn && (
              <div className="p-3 bg-[#141416] border border-emerald-500/20 rounded-xl space-y-3">
                <div>
                  <label className="block font-bold text-amber-400 text-[10px] tracking-wider uppercase mb-1">
                    Template Dropdown OH (Kamera Sending):
                  </label>
                  <textarea
                    value={msgTemplateOh}
                    onChange={(e) => setMsgTemplateOh(e.target.value)}
                    rows={3}
                    className="w-full p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-all resize-none text-white text-[11px] leading-relaxed"
                    placeholder="Template pesan OH..."
                  />
                </div>
                <div>
                  <label className="block font-bold text-rose-400 text-[10px] tracking-wider uppercase mb-1">
                    Template Dropdown Return (Kamera Sending):
                  </label>
                  <textarea
                    value={msgTemplateReturn}
                    onChange={(e) => setMsgTemplateReturn(e.target.value)}
                    rows={3}
                    className="w-full p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none transition-all resize-none text-white text-[11px] leading-relaxed"
                    placeholder="Template pesan Return..."
                  />
                </div>
                <p className="text-[9px] text-neutral-500">
                  Variabel tersedia: <span className="font-mono text-neutral-300">{'{Nama}'}</span>,{' '}
                  <span className="font-mono text-neutral-300">{'{Alamat}'}</span>,{' '}
                  <span className="font-mono text-neutral-300">{'{NoHP}'}</span>,{' '}
                  <span className="font-mono text-neutral-300">{'{COD}'}</span>,{' '}
                  <span className="font-mono text-neutral-300">{'{GPS}'}</span>
                </p>
              </div>
            )}

            {/* Kelola Daftar Tempat Titip COD & Alamat Terkait */}
            <div className="bg-neutral-900/80 border border-neutral-800 rounded-xl p-3 space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <label className="block font-bold text-[#C5A059] text-[10px] tracking-wider uppercase">
                    Tempat Titip COD &amp; Alamat Terkait ({`{tempat cod}`}):
                  </label>
                  <p className="text-[10px] text-neutral-400 mt-0.5">
                    Masukkan kata kunci alamat terkait agar sistem otomatis merekomendasikan tempat titip.
                  </p>
                </div>
                <button
                  onClick={handleResetDefaultLocations}
                  className="text-[9px] text-neutral-400 hover:text-amber-400 underline transition-all cursor-pointer shrink-0 ml-2"
                  title="Kembalikan ke 4 lokasi default"
                >
                  Reset Default
                </button>
              </div>

              {/* List of current locations with address input */}
              <div className="space-y-2">
                {tempatCodList.map((loc) => (
                  <div 
                    key={loc.id}
                    className="bg-neutral-950 border border-neutral-800/80 rounded-xl p-2.5 space-y-1.5"
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-1.5 text-amber-300 font-bold text-xs capitalize">
                        <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        {loc.name}
                      </div>
                      <button
                        onClick={() => handleDeleteLocation(loc.id)}
                        className="p-1 hover:bg-red-500/20 text-neutral-500 hover:text-red-400 rounded-md transition-colors cursor-pointer"
                        title="Hapus lokasi"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div>
                      <label className="block text-[9px] text-neutral-400 mb-1">
                        Alamat / Kata Kunci Alamat Terkait (pisahkan dengan koma):
                      </label>
                      <input 
                        type="text"
                        value={loc.targetAddress}
                        onChange={(e) => handleUpdateLocationAddress(loc.id, e.target.value)}
                        placeholder="Contoh: sugihwaras, RT 02, desa A"
                        className="w-full bg-neutral-900 border border-neutral-800 focus:border-amber-500 rounded-lg px-2.5 py-1 text-[11px] text-white outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Form to add new location with name and address */}
              <div className="pt-2 border-t border-neutral-800 space-y-2">
                <span className="block text-[10px] font-bold text-neutral-400 uppercase">
                  + Tambah Tempat Titip Baru:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input 
                    type="text"
                    value={newLocationName}
                    onChange={(e) => setNewLocationName(e.target.value)}
                    placeholder="Nama tempat (misal: Toko Bu Slamet)"
                    className="bg-black border border-neutral-800 focus:border-[#C5A059] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                  />
                  <input 
                    type="text"
                    value={newLocationAddress}
                    onChange={(e) => setNewLocationAddress(e.target.value)}
                    placeholder="Alamat terkait (misal: Dusun Krajan)"
                    className="bg-black border border-neutral-800 focus:border-[#C5A059] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                  />
                </div>
                <button
                  onClick={handleAddLocation}
                  disabled={!newLocationName.trim()}
                  className="w-full py-1.5 bg-[#C5A059] hover:bg-[#D4AF37] disabled:opacity-30 text-black font-bold text-xs rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Tambah Tempat Titip
                </button>
              </div>
            </div>

            {/* Placeholder Guide Info */}
            <div className="p-2.5 rounded-xl bg-neutral-900/50 border border-neutral-800/80 text-neutral-400 text-[10px] leading-relaxed space-y-1">
              <p>
                Gunakan placeholder <code className="bg-neutral-800 text-neutral-300 px-1 py-0.5 rounded font-mono font-bold">{`{Nama}`}</code>, <code className="bg-neutral-800 text-neutral-300 px-1 py-0.5 rounded font-mono font-bold">{`{COD}`}</code> (dibulatkan), dan <code className="bg-neutral-800 text-neutral-300 px-1 py-0.5 rounded font-mono font-bold">{`{tempat cod}`}</code> untuk menyisipkan data secara otomatis.
              </p>
              <p className="text-neutral-500">
                Setiap template di atas menjadi <strong className="text-neutral-300">acuan struktur penyampaian</strong>: isi pesan tiap customer otomatis divariasikan secara halus agar tidak kaku/kembar tanpa menyimpang dari template yang ditetapkan.
              </p>
            </div>

            <div className="h-px bg-neutral-800 my-2" />

            {/* Quick Data Actions */}
            <div className="space-y-2">
              <span className="block font-bold text-neutral-400 text-[10px] tracking-wider uppercase">
                Aksi Cepat Data:
              </span>
              
              <button 
                onClick={() => {
                  setShowSettingsInsidePhone(false);
                  setShowResetModal(true);
                }}
                className="w-full py-2.5 text-[11px] font-bold uppercase tracking-wider rounded-xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5 text-amber-400" /> Reset / Atur Hitungan Sukses
              </button>

              <button 
                onClick={() => {
                  loadSampleData();
                  setShowSettingsInsidePhone(false);
                }}
                className="w-full py-2.5 text-[11px] font-bold uppercase tracking-wider rounded-xl border border-neutral-800 hover:border-neutral-700 bg-neutral-900 hover:bg-neutral-850 text-neutral-300 transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#C5A059]" /> Gunakan Data Contoh
              </button>

              <button 
                onClick={() => {
                  if (window.confirm('Apakah Anda yakin ingin menghapus semua data?')) {
                    clearAllData();
                    setShowSettingsInsidePhone(false);
                  }
                }}
                disabled={customers.length === 0}
                className="w-full py-2.5 text-[11px] font-bold uppercase tracking-wider rounded-xl bg-red-950/40 hover:bg-red-950/60 text-red-400 border border-red-900/40 disabled:opacity-30 disabled:hover:bg-transparent transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" /> Hapus Semua Data
              </button>
            </div>

          </div>

          {/* Close Button Footer */}
          <div className="mt-4 pt-3 border-t border-neutral-800">
            <button
              onClick={() => setShowSettingsInsidePhone(false)}
              className="w-full py-2.5 bg-[#C5A059] hover:bg-[#D4AF37] text-black font-bold rounded-xl text-xs cursor-pointer transition-all text-center"
            >
              Simpan &amp; Kembali
            </button>
          </div>

        </motion.div>
      )}
    </AnimatePresence>
  );
};
