import React from 'react';
import { MessageSquare, ChevronRight, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface WASheetModalProps {
  showWASheet: boolean;
  setShowWASheet: (show: boolean) => void;
  handleSendPhotosToWhatsApp: (isBusiness: boolean) => void;
}

export const WASheetModal: React.FC<WASheetModalProps> = ({
  showWASheet,
  setShowWASheet,
  handleSendPhotosToWhatsApp,
}) => {
  return (
    <AnimatePresence>
      {showWASheet && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end justify-center"
          onClick={() => setShowWASheet(false)}
        >
          <motion.div
            initial={{ y: 200 }}
            animate={{ y: 0 }}
            exit={{ y: 200 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="w-full bg-[#121214] border-t-2 border-[#C5A059]/30 rounded-t-[28px] p-5 shadow-2xl relative text-left"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Visual drag indicator */}
            <div className="w-10 h-1 bg-neutral-800 rounded-full mx-auto mb-4" />

            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-sm font-black text-white text-left">Kirim Foto Bukti</h3>
                <p className="text-[10px] text-neutral-400 text-left">Pilih jenis aplikasi WhatsApp untuk mengirimkan bukti</p>
              </div>
              <button 
                onClick={() => setShowWASheet(false)}
                className="p-1.5 rounded-full bg-neutral-900 text-neutral-500 hover:text-white border border-neutral-800 transition-all cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-2.5">
              <button
                onClick={() => handleSendPhotosToWhatsApp(false)}
                className="w-full py-3 px-4 bg-[#25D366]/10 hover:bg-[#25D366]/20 border border-[#25D366]/20 hover:border-[#25D366]/40 rounded-xl text-left transition-all cursor-pointer flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#25D366]/10 flex items-center justify-center text-[#25D366]">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-bold text-white">WhatsApp Biasa</div>
                    <div className="text-[9px] text-neutral-400">Kirim ke akun WhatsApp personal</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-neutral-500" />
              </button>

              <button
                onClick={() => handleSendPhotosToWhatsApp(true)}
                className="w-full py-3 px-4 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 hover:border-emerald-500/40 rounded-xl text-left transition-all cursor-pointer flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-bold text-white">WhatsApp Business</div>
                    <div className="text-[9px] text-neutral-400">Kirim ke akun WhatsApp Business</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-neutral-500" />
              </button>
            </div>

            <div className="mt-4 bg-amber-500/5 border border-amber-500/10 rounded-xl p-3 text-[10px] text-neutral-400 leading-relaxed text-left">
              💡 <span className="text-[#D4AF37] font-bold">Catatan Praktis:</span> Gambar bukti terakhir akan disalin otomatis ke clipboard. Saat chat WhatsApp terbuka, cukup tekan <span className="font-mono bg-neutral-900 px-1 py-0.5 rounded text-white text-[9px]">Paste / Tempel</span> (atau Ctrl+V) untuk langsung melampirkan fotonya!
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
