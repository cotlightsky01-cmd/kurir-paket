import React from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface PhotoLightboxModalProps {
  lightboxPhoto: string | null;
  setLightboxPhoto: (photo: string | null) => void;
}

export const PhotoLightboxModal: React.FC<PhotoLightboxModalProps> = ({
  lightboxPhoto,
  setLightboxPhoto,
}) => {
  return (
    <AnimatePresence>
      {lightboxPhoto && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/95 z-50 flex flex-col justify-center items-center p-6"
          onClick={() => setLightboxPhoto(null)}
        >
          <button 
            onClick={() => setLightboxPhoto(null)}
            className="absolute top-8 right-8 p-2 rounded-full bg-neutral-900 text-white border border-neutral-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <img 
            src={lightboxPhoto} 
            alt="Bukti Paket Pembesar" 
            className="max-w-full max-h-[80%] rounded-2xl object-contain border border-[#C5A059]/20"
            referrerPolicy="no-referrer"
          />
          <p className="text-[11px] text-neutral-500 mt-4 text-center">
            Tap di mana saja untuk kembali ke aplikasi.
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
