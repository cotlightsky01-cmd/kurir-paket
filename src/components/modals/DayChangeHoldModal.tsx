import React from 'react';
import { Bell, X, Clock, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface DayChangeHoldModalProps {
  showDayChangePopup: boolean;
  setShowDayChangePopup: (show: boolean) => void;
  holdCountTodayAlert: number;
  setActiveTab: (tab: 'filling' | 'modul1' | 'modul2' | 'modul3') => void;
}

export const DayChangeHoldModal: React.FC<DayChangeHoldModalProps> = ({
  showDayChangePopup,
  setShowDayChangePopup,
  holdCountTodayAlert,
  setActiveTab,
}) => {
  return (
    <AnimatePresence>
      {showDayChangePopup && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-5"
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            className="w-full max-w-sm bg-[#121214] border-2 border-amber-500/30 rounded-[28px] p-5 shadow-2xl relative"
          >
            {/* Close absolute button */}
            <button 
              onClick={() => setShowDayChangePopup(false)}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800 hover:border-neutral-700 transition-all cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>

            <div className="flex flex-col items-center text-center mt-2">
              {/* Glowing pulsing bell container */}
              <div className="w-14 h-14 bg-amber-500/10 rounded-2xl border border-amber-500/20 flex items-center justify-center mb-4 relative">
                <Bell className="w-7 h-7 text-amber-500 animate-bounce" />
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full" />
              </div>

              <h3 className="text-base font-black text-white leading-tight">
                Paket Hold Terbengkalai!
              </h3>
              
              <p className="text-xs text-neutral-400 mt-2.5 leading-relaxed">
                Hai kurir, hari telah berganti! Ada <span className="text-amber-400 font-extrabold">{holdCountTodayAlert} paket</span> di status <span className="text-amber-500 font-semibold">Hold (Belum Selesai)</span> yang tersisa dari hari sebelumnya.
              </p>

              <div className="w-full bg-amber-500/5 border border-amber-500/10 rounded-xl p-3 mt-4 text-left">
                <div className="flex items-center gap-2 text-amber-400 text-[11px] font-bold">
                  <Clock className="w-3.5 h-3.5" /> Tindakan Diperlukan
                </div>
                <p className="text-[10px] text-neutral-500 mt-1 leading-snug">
                  Segera periksa alamat, hubungi pelanggan, atau jadwalkan ulang pengiriman agar performa kurir Anda tetap optimal hari ini!
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5 w-full mt-5">
                <button
                  onClick={() => setShowDayChangePopup(false)}
                  className="py-2.5 bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 rounded-xl text-neutral-400 hover:text-white text-[11px] font-bold cursor-pointer transition-all"
                >
                  Nanti Saja
                </button>
                <button
                  onClick={() => {
                    setActiveTab('modul3');
                    setShowDayChangePopup(false);
                  }}
                  className="py-2.5 bg-[#C5A059] text-black hover:bg-[#D4AF37] rounded-xl text-[11px] font-extrabold cursor-pointer transition-all shadow-lg flex items-center justify-center gap-1"
                >
                  Tinjau Sekarang <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
