import React from 'react';
import { Image as ImageIcon, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface SelectedPhotoItem {
  id: string;
  url: string;
  customerName: string;
  phone: string;
  cleanPhone?: string;
  index: number;
}

interface FloatingPhotoBarProps {
  selectedPhotos: SelectedPhotoItem[];
  setSelectedPhotos: (photos: SelectedPhotoItem[]) => void;
  setShowWASheet: (show: boolean) => void;
}

export const FloatingPhotoBar: React.FC<FloatingPhotoBarProps> = ({
  selectedPhotos,
  setSelectedPhotos,
  setShowWASheet,
}) => {
  return (
    <AnimatePresence>
      {selectedPhotos.length > 0 && (
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 50, opacity: 0 }}
          className="absolute bottom-36 left-3 right-3 bg-[#18181C] border border-[#C5A059]/40 rounded-2xl p-3 shadow-2xl z-40 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#C5A059]/10 border border-[#C5A059]/30 flex items-center justify-center text-[#D4AF37]">
              <ImageIcon className="w-4 h-4 animate-pulse" />
            </div>
            <div className="text-left">
              <div className="text-[11px] font-black text-white">
                {selectedPhotos.length} Foto Terpilih
              </div>
              <div className="text-[9px] text-neutral-400 truncate max-w-[150px]">
                Kirim ke {selectedPhotos[0].customerName}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSelectedPhotos([])}
              className="px-2.5 py-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 text-[10px] font-bold transition-all cursor-pointer"
            >
              Batal
            </button>
            <button
              onClick={() => setShowWASheet(true)}
              className="px-3.5 py-1.5 bg-[#C5A059] hover:bg-[#D4AF37] text-black font-black rounded-lg text-[10px] flex items-center gap-1 transition-all cursor-pointer shadow-lg shadow-amber-500/10 animate-bounce"
            >
              Kirim <Send className="w-3 h-3" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
