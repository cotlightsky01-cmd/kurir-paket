import React from 'react';
import { MapPin, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Customer, TempatCodLocation } from '../../types';
import { getMatchingTempatCod, getRoundedCodFormatted } from '../../utils/helpers';

interface DropOffLocationModalProps {
  dropOffModalCustomer: Customer | null;
  setDropOffModalCustomer: (cust: Customer | null) => void;
  tempatCodList: TempatCodLocation[];
  handleWhatsAppChat: (customer: Customer, dropOffLocation?: string) => void;
}

export const DropOffLocationModal: React.FC<DropOffLocationModalProps> = ({
  dropOffModalCustomer,
  setDropOffModalCustomer,
  tempatCodList,
  handleWhatsAppChat,
}) => {
  return (
    <AnimatePresence>
      {dropOffModalCustomer && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setDropOffModalCustomer(null)}
        >
          <motion.div
            initial={{ scale: 0.9, y: 15 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-[#121214] border border-amber-500/30 rounded-[24px] p-5 shadow-2xl relative"
          >
            <button 
              onClick={() => setDropOffModalCustomer(null)}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800 transition-all cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                <MapPin className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white leading-tight">
                  Pilih Tempat Titip COD
                </h3>
                <p className="text-[11px] text-neutral-400 mt-0.5">
                  Untuk: <span className="text-amber-300 font-semibold">{dropOffModalCustomer.name}</span> ({getRoundedCodFormatted(dropOffModalCustomer.cod)})
                </p>
              </div>
            </div>

            <p className="text-[11px] text-neutral-400 mb-3 leading-relaxed">
              Pilih lokasi penitipan paket untuk langsung mengirim template WhatsApp khusus:
            </p>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {tempatCodList.map((locationItem) => {
                const matchedLoc = getMatchingTempatCod(dropOffModalCustomer.address, tempatCodList);
                const isMatched = matchedLoc?.id === locationItem.id;

                return (
                  <button
                    key={locationItem.id}
                    onClick={() => {
                      handleWhatsAppChat(dropOffModalCustomer, locationItem.name);
                      setDropOffModalCustomer(null);
                    }}
                    className={`w-full p-3 rounded-xl text-left transition-all cursor-pointer flex items-center justify-between group border ${
                      isMatched 
                        ? 'bg-amber-500/20 border-amber-500/60 shadow-lg' 
                        : 'bg-neutral-900/90 hover:bg-amber-500/15 border-neutral-800 hover:border-amber-500/40'
                    }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <MapPin className={`w-4 h-4 shrink-0 ${isMatched ? 'text-amber-300' : 'text-amber-400'}`} />
                        <span className={`text-xs font-bold capitalize ${isMatched ? 'text-amber-200' : 'text-white group-hover:text-amber-300'}`}>
                          {locationItem.name}
                        </span>
                        {isMatched && (
                          <span className="text-[9px] font-extrabold bg-amber-400 text-black px-1.5 py-0.2 rounded uppercase tracking-wider">
                            Cocok Alamat
                          </span>
                        )}
                      </div>
                      {locationItem.targetAddress && (
                        <span className="text-[10px] text-neutral-400 pl-6">
                          Alamat: {locationItem.targetAddress}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-amber-400 font-bold group-hover:translate-x-0.5 transition-all shrink-0">
                      Kirim WA &rarr;
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 pt-3 border-t border-neutral-800/80 flex justify-between items-center text-[10px] text-neutral-500">
              <span>Tambah/edit lokasi di menu Setting</span>
              <button
                onClick={() => setDropOffModalCustomer(null)}
                className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg font-bold cursor-pointer"
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
