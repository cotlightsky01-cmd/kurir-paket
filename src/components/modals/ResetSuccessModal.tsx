import React from 'react';
import { RotateCcw, X, ChevronLeft, Trash2, Archive } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Customer } from '../../types';
import { sumPackageCounts } from '../../utils/helpers';

interface ResetSuccessModalProps {
  showResetModal: boolean;
  setShowResetModal: (show: boolean) => void;
  todaySuccessList: Customer[];
  allSuccessList: Customer[];
  handleResetTodayCountToZero: () => void;
  handleReturnTodaySuccessToSending: () => void;
  handleClearAllSuccessData: () => void;
  handleArchiveAllSuccessData?: () => void;
}

export const ResetSuccessModal: React.FC<ResetSuccessModalProps> = ({
  showResetModal,
  setShowResetModal,
  todaySuccessList,
  allSuccessList,
  handleResetTodayCountToZero,
  handleReturnTodaySuccessToSending,
  handleClearAllSuccessData,
  handleArchiveAllSuccessData,
}) => {
  return (
    <AnimatePresence>
      {showResetModal && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.9, y: 15 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 15 }}
            className="w-full max-w-sm bg-[#121214] border border-amber-500/30 rounded-2xl p-5 shadow-2xl relative"
          >
            <button 
              onClick={() => setShowResetModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2.5 mb-3 border-b border-neutral-800 pb-3">
              <div className="p-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-white">Reset / Atur Hitungan Sukses</h3>
                <p className="text-[10px] text-neutral-400">Pilih tindakan yang ingin dilakukan pada data kiriman sukses</p>
              </div>
            </div>

            <div className="space-y-2.5 my-4">
              {/* Option 0: Archive All Success Data */}
              {handleArchiveAllSuccessData && (
                <button
                  onClick={() => {
                    setShowResetModal(false);
                    handleArchiveAllSuccessData();
                  }}
                  disabled={allSuccessList.length === 0}
                  className="w-full text-left p-3 rounded-xl bg-emerald-950/30 hover:bg-emerald-900/40 border border-emerald-500/40 hover:border-emerald-400 transition-all cursor-pointer disabled:opacity-40"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                      <Archive className="w-3.5 h-3.5" /> Pindahkan Ke Arsip Data
                    </span>
                    <span className="text-[10px] bg-emerald-900/60 border border-emerald-500/40 px-2 py-0.5 rounded font-mono text-emerald-300">
                      {sumPackageCounts(allSuccessList)} paket
                    </span>
                  </div>
                  <p className="text-[10px] text-emerald-200/70 mt-1 leading-snug">
                    Memindahkan {sumPackageCounts(allSuccessList)} paket sukses dari tab Selesai ke menu Arsip Data agar tersimpan rapi.
                  </p>
                </button>
              )}
              {/* Option 1: Reset count of today to 0 by moving to history */}
              <button
                onClick={handleResetTodayCountToZero}
                disabled={todaySuccessList.length === 0}
                className="w-full text-left p-3 rounded-xl bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 hover:border-amber-500/40 transition-all cursor-pointer disabled:opacity-40 disabled:hover:bg-neutral-900"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5" /> Reset Hitungan Hari Ini (Paket &amp; COD &rarr; 0)
                  </span>
                  <span className="text-[10px] bg-neutral-800 px-2 py-0.5 rounded font-mono text-neutral-400">
                    {sumPackageCounts(todaySuccessList)} paket
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 mt-1 leading-snug">
                  Mereset jumlah paket hari ini menjadi 0 &amp; nominal COD hari ini menjadi Rp 0. Data COD &amp; Opsi Pembayaran otomatis dihapus sehingga kartu riwayat hanya menyisakan nama, nomor HP, dan alamat agar lebih rapi. Data tidak lengkap akan otomatis dihapus permanen.
                </p>
              </button>

              {/* Option 2: Return today success items back to Sending */}
              <button
                onClick={handleReturnTodaySuccessToSending}
                disabled={todaySuccessList.length === 0}
                className="w-full text-left p-3 rounded-xl bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 hover:border-blue-500/40 transition-all cursor-pointer disabled:opacity-40 disabled:hover:bg-neutral-900"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
                    <ChevronLeft className="w-3.5 h-3.5" /> Kembalikan ke Tab Sending
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 mt-1 leading-snug">
                  Mengembalikan seluruh paket sukses hari ini ke tab Sending (Modul 1) untuk diatur ulang.
                </p>
              </button>

              {/* Option 3: Delete all success data */}
              <button
                onClick={handleClearAllSuccessData}
                disabled={allSuccessList.length === 0}
                className="w-full text-left p-3 rounded-xl bg-red-950/20 hover:bg-red-950/40 border border-red-900/30 hover:border-red-500/50 transition-all cursor-pointer disabled:opacity-40"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-red-400 flex items-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5" /> Hapus Seluruh Data Sukses
                  </span>
                  <span className="text-[10px] bg-red-950/50 border border-red-900/40 px-2 py-0.5 rounded font-mono text-red-400">
                    {sumPackageCounts(allSuccessList)} paket
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 mt-1 leading-snug">
                  Menghapus permanen semua data paket di tab Success.
                </p>
              </button>
            </div>

            <div className="pt-2 border-t border-neutral-800 flex justify-end">
              <button
                onClick={() => setShowResetModal(false)}
                className="w-full py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-bold rounded-xl text-xs transition-all cursor-pointer"
              >
                Batal
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
