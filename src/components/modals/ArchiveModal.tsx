import React, { useState } from 'react';
import { Archive, X, Search, RotateCcw, Check, Calendar } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Customer } from '../../types';
import { formatRupiah, deduplicateById } from '../../utils/helpers';

interface ArchiveModalProps {
  showArchiveModal: boolean;
  setShowArchiveModal: (show: boolean) => void;
  archivedCustomers: Customer[];
  pullBackCustomer: (customer: Customer) => void;
}

export const ArchiveModal: React.FC<ArchiveModalProps> = ({
  showArchiveModal,
  setShowArchiveModal,
  archivedCustomers,
  pullBackCustomer,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [pulledIds, setPulledIds] = useState<string[]>([]);

  const filtered = deduplicateById(archivedCustomers).filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.address.toLowerCase().includes(q) ||
      c.cod.toLowerCase().includes(q)
    );
  });

  const handlePullBack = (c: Customer) => {
    pullBackCustomer(c);
    setPulledIds((prev) => [...prev, c.id]);
  };

  return (
    <AnimatePresence>
      {showArchiveModal && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="fixed inset-2 sm:inset-10 md:inset-x-20 lg:inset-x-32 xl:inset-x-60 top-4 bottom-4 bg-[#0B0B0C]/98 border border-[#2A2A30] rounded-2xl z-50 flex flex-col overflow-hidden p-4 shadow-2xl"
        >
          {/* Archive Header */}
          <div className="flex justify-between items-center mb-3 border-b border-neutral-800 pb-3">
            <div>
              <span className="text-[10px] tracking-widest uppercase text-emerald-400 font-extrabold flex items-center gap-1.5">
                <Archive className="w-3.5 h-3.5 text-emerald-400" /> ARSIP DATA SUKSES (&gt;3 HARI)
              </span>
              <h4 className="text-xs font-bold text-white mt-0.5 flex items-center gap-2">
                Pencarian &amp; Tarik Ulang Data Selesai
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                  {archivedCustomers.length} Paket Tersimpan
                </span>
              </h4>
            </div>
            <button
              onClick={() => setShowArchiveModal(false)}
              className="p-1.5 rounded-full bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Archive Info Banner */}
          <div className="mb-3 p-2.5 rounded-xl bg-[#141416] border border-[#232328] flex items-center gap-2 text-xs">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
              <Archive className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[11px] font-bold text-white">
                Penyimpanan Arsip Aman Terintegrasi
              </div>
              <div className="text-[10px] text-neutral-400">
                Semua paket selesai yang berusia lebih dari 3 hari otomatis disimpan di sini agar aplikasi tetap cepat. Anda dapat mencari dan menarik kembali data kapan saja.
              </div>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative mb-3">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama, no HP, atau alamat di data arsip..."
              className="w-full pl-9 pr-4 py-2 bg-neutral-900 border border-neutral-800 rounded-xl text-white text-xs placeholder-neutral-500 focus:outline-none focus:border-emerald-500 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 text-xs"
              >
                Clear
              </button>
            )}
          </div>

          {/* Archived Customer List */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-neutral-800">
            {filtered.length === 0 ? (
              <div className="py-12 text-center text-neutral-500 text-xs space-y-2">
                <Archive className="w-8 h-8 mx-auto opacity-30 text-emerald-400" />
                <p>Belum ada data arsip yang cocok dengan pencarian.</p>
                <p className="text-[10px] text-neutral-600">
                  Paket selesai yang berusia di atas 3 hari akan otomatis masuk ke arsip ini.
                </p>
              </div>
            ) : (
              filtered.map((c) => {
                const isPulled = pulledIds.includes(c.id);
                const dateStr = c.completedAt
                  ? new Date(c.completedAt).toLocaleDateString('id-ID', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })
                  : 'Selesai';

                return (
                  <div
                    key={c.id}
                    className="p-3 bg-[#121214] border border-[#232328] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:border-emerald-500/30 transition-all"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">{c.name}</span>
                        <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                          {c.phone}
                        </span>
                        <span className="text-[10px] text-neutral-400 flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-neutral-500" /> {dateStr}
                        </span>
                      </div>

                      <p className="text-[11px] text-neutral-300 line-clamp-1">{c.address}</p>

                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="text-amber-400 font-semibold">
                          COD: {c.cod !== 'NO COD' ? formatRupiah(c.cod) : 'NO COD'}
                        </span>
                        <span className="text-neutral-500">•</span>
                        <span className="text-neutral-400">Bayar: {c.paymentType || 'COD'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handlePullBack(c)}
                        disabled={isPulled}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                          isPulled
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 cursor-default'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/30'
                        }`}
                      >
                        {isPulled ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            Berhasil Ditarik Ke Atas
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-3.5 h-3.5" />
                            Tarik ke Atas / Gunakan Lagi
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
