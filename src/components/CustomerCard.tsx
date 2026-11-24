import React from 'react';
import { 
  MessageSquare, 
  Trash2, 
  CheckCircle, 
  ChevronRight, 
  MapPin, 
  Check, 
  Camera, 
  X, 
  Clock, 
  ChevronLeft, 
  Eye, 
  Edit2, 
  Plus
} from 'lucide-react';
import { motion } from 'motion/react';
import { Customer, TempatCodLocation, WaAutoSendItemResult } from '../types';
import { 
  getPackageCount, 
  getMatchingTempatCod, 
  parseCodAmount, 
  formatRupiah, 
  formatCompletedDate,
  isToday 
} from '../utils/helpers';

interface CustomerCardProps {
  cust: Customer;
  activeTab: 'filling' | 'modul1' | 'modul2' | 'modul3';
  displayIndex?: number;
  tempatCodList: TempatCodLocation[];
  editingCodId: string | null;
  editingCodText: string;
  setEditingCodId: (id: string | null) => void;
  setEditingCodText: (text: string) => void;
  handleSaveCodAmount: (id: string, newCodVal: string) => void;
  handleWhatsAppChat: (customer: Customer, dropOffLocation?: string) => void;
  setDropOffModalCustomer: (cust: Customer | null) => void;
  updatePaymentType: (id: string, type: 'COD' | 'TF') => void;
  setCameraActiveForId: (id: string | null) => void;
  selectedPhotos: { id: string; url: string; customerName: string; phone: string; cleanPhone?: string; index: number }[];
  togglePhotoSelection: (cust: Customer, photoUrl: string, idx: number) => void;
  deleteCustomerPhoto: (customerId: string, photoIndex: number) => void;
  setLightboxPhoto: (photo: string | null) => void;
  deleteCustomer: (id: string) => void;
  moveToModul2: (id: string) => void;
  moveToModul3AndCapture: (customer: Customer) => void;
  returnToModul1: (id: string) => void;
  toggleCustomerCompletedDate?: (id: string) => void;
  autoSendItem?: WaAutoSendItemResult;
}

export const CustomerCard: React.FC<CustomerCardProps> = ({
  cust,
  activeTab,
  displayIndex,
  tempatCodList,
  editingCodId,
  editingCodText,
  setEditingCodId,
  setEditingCodText,
  handleSaveCodAmount,
  handleWhatsAppChat,
  setDropOffModalCustomer,
  updatePaymentType,
  setCameraActiveForId,
  selectedPhotos,
  togglePhotoSelection,
  deleteCustomerPhoto,
  setLightboxPhoto,
  deleteCustomer,
  moveToModul2,
  moveToModul3AndCapture,
  returnToModul1,
  toggleCustomerCompletedDate,
  autoSendItem,
}) => {
  const isModul2Today = cust.status === 'modul2' && isToday(cust.completedAt || cust.timestamp);
  const cardSeqNumber = displayIndex !== undefined ? displayIndex : cust.originalIndex;

  return (
    <div className="relative group">
      {/* Swipe indication background (dual side underlay) */}
      {activeTab === 'modul1' && (
        <div className="absolute inset-0 bg-[#1e1e24] rounded-xl flex justify-between items-center px-6 z-0 border border-neutral-800">
          <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5" /> Selesai (Success)
          </span>
          <span className="text-[10px] font-bold text-amber-500 flex items-center gap-1">
            Hold (Modul 3) <Camera className="w-3.5 h-3.5" />
          </span>
        </div>
      )}

      {/* Card container */}
      <motion.div
        drag={activeTab === 'modul1' ? "x" : false}
        dragDirectionLock
        dragConstraints={{ left: -140, right: 140 }}
        onDragEnd={(_, info) => {
          if (activeTab === 'modul1') {
            if (info.offset.x > 80) {
              moveToModul2(cust.id);
            } else if (info.offset.x < -80) {
              moveToModul3AndCapture(cust);
            }
          }
        }}
        className={`bg-[#18181B] border rounded-xl p-3 relative z-10 shadow-sm ${
          cust.status === 'modul2' && isModul2Today
            ? 'border-emerald-500/30'
            : 'border-[#232328]'
        } ${activeTab === 'modul1' ? 'touch-none' : 'touch-pan-y'}`}
        style={{ x: 0 }}
      >
        <div className="flex justify-between items-start gap-2 mb-1.5">
          <div className="flex items-center gap-2">
            <span className="min-w-5 h-5 px-1 rounded-full bg-[#27272A] text-white flex items-center justify-center text-[10px] font-bold shrink-0">
              {cardSeqNumber}
            </span>
            <h4 className="text-xs font-bold text-white tracking-wide">
              {cust.name}
            </h4>
          </div>
          <div className="flex items-center gap-1.5">
            {getPackageCount(cust) > 1 && (
              <span className="text-[9px] font-extrabold tracking-wider px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 shadow-sm" title={`Terdeteksi ${getPackageCount(cust)} paket`}>
                📦 {getPackageCount(cust)} Paket
              </span>
            )}
            {cust.status === 'modul1' && (
              <div className="flex items-center gap-1">
                {autoSendItem && (
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                      autoSendItem.status === 'sent_full'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : autoSendItem.status === 'sent_cod_only'
                        ? 'bg-[#C5A059]/20 text-[#E9D5A6] border-[#C5A059]/40'
                        : autoSendItem.status === 'skipped_chatted'
                        ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                        : autoSendItem.status === 'waiting_delay' || autoSendItem.status === 'sending'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                        : autoSendItem.status === 'paused'
                        ? 'bg-amber-500/15 text-amber-200 border-amber-500/30'
                        : autoSendItem.status === 'invalid_phone' ||
                          autoSendItem.status === 'unregistered' ||
                          autoSendItem.status === 'failed'
                        ? 'bg-red-500/15 text-red-300 border-red-500/30'
                        : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                    }`}
                    title={autoSendItem.reason || ''}
                  >
                    {autoSendItem.status === 'sent_full'
                      ? 'Auto: Lengkap'
                      : autoSendItem.status === 'sent_cod_only'
                      ? 'Auto: COD Saja'
                      : autoSendItem.status === 'skipped_chatted'
                      ? 'Skip (Sudah Chat)'
                      : autoSendItem.status === 'waiting_delay'
                      ? 'Menunggu Jeda...'
                      : autoSendItem.status === 'sending'
                      ? 'Mengirim...'
                      : autoSendItem.status === 'paused'
                      ? 'Dijeda'
                      : autoSendItem.status === 'pending'
                      ? 'Antrean'
                      : autoSendItem.status === 'cancelled'
                      ? 'Dihentikan'
                      : 'Gagal / Invalid'}
                  </span>
                )}
                <span className="text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/10">
                  Incoming
                </span>
                <button 
                  type="button"
                  onClick={() => setCameraActiveForId(cust.id)}
                  className="p-1 rounded bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 cursor-pointer transition-all"
                  title="Kamera Kirim Foto, Nama, Alamat & Lokasi GPS ke WA Business"
                >
                  <Camera className="w-3 h-3 text-emerald-400" />
                </button>
              </div>
            )}
            {cust.status === 'modul2' && (
              <span className={`text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded flex items-center gap-1 ${
                isModul2Today
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-neutral-800 text-neutral-400 border border-neutral-700/50'
              }`}>
                <Clock className="w-2.5 h-2.5" /> {isModul2Today ? 'Hari Ini' : 'Data Sebelumnya'}
              </span>
            )}
            {cust.status === 'modul3' && (
              <span className="text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/10 flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" /> Hold
              </span>
            )}
          </div>
        </div>

        {/* Details list */}
        <div className="space-y-1.5 text-[11px] text-neutral-400 border-t border-[#232328]/60 pt-1.5">
          {/* Phone details */}
          <div className="flex justify-between items-center">
            <span className="text-neutral-500">No. HP:</span>
            <div className="flex items-center gap-1.5 font-mono text-neutral-300">
              {cust.phone}
              {cust.cleanPhone && (
                <div className="flex items-center gap-1">
                  <button 
                    onClick={() => handleWhatsAppChat(cust)}
                    className={`p-1.5 rounded flex items-center gap-1 transition-all cursor-pointer text-[10px] font-bold ${
                      cust.waTemplateSent 
                        ? 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white border border-neutral-700/50' 
                        : 'bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 border border-[#25D366]/20'
                    }`}
                    title={cust.waTemplateSent ? "Hubungi WA Lagi (Tanpa Template / Chat Bersih)" : "Kirim Pesan WhatsApp (Dengan Template)"}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    {cust.waTemplateSent && (
                      <span className="text-[9px] font-medium text-neutral-400 flex items-center gap-0.5">
                        <Check className="w-2.5 h-2.5 text-green-500" /> Terkirim
                      </span>
                    )}
                  </button>

                  <button 
                    onClick={() => setDropOffModalCustomer(cust)}
                    className="p-1.5 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 flex items-center gap-1 transition-all cursor-pointer text-[10px] font-bold"
                    title="Titip Paket di Tempat COD"
                  >
                    <MapPin className="w-3.5 h-3.5 text-amber-400" />
                    <span>Titip</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Address */}
          <div className="flex items-start justify-between gap-4">
            <span className="text-neutral-500 shrink-0">Alamat:</span>
            <span className="text-right text-neutral-300 line-clamp-2" title={cust.address}>
              {cust.address}
            </span>
          </div>

          {/* Matched Tempat COD badge if address matches */}
          {getMatchingTempatCod(cust.address, tempatCodList) && (
            <div className="flex justify-end pt-0.5">
              <span 
                onClick={() => handleWhatsAppChat(cust, getMatchingTempatCod(cust.address, tempatCodList)?.name)}
                className="text-[9px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-md flex items-center gap-1 cursor-pointer hover:bg-amber-500/25 transition-all"
                title="Otomatis gunakan template Titip di lokasi ini"
              >
                <MapPin className="w-2.5 h-2.5 text-amber-400" />
                Titip Otomatis: {getMatchingTempatCod(cust.address, tempatCodList)?.name}
              </span>
            </div>
          )}

          {/* COD Nominal & Inline Edit */}
          {editingCodId === cust.id ? (
            <div className="flex items-center gap-1 my-1 pt-1 border-t border-[#232328]/40">
              <input 
                type="text"
                value={editingCodText}
                onChange={(e) => setEditingCodText(e.target.value)}
                placeholder="Rp 50.000 atau kosongkan"
                className="bg-black border border-emerald-500 rounded px-2 py-0.5 text-xs text-white font-mono w-full"
                autoFocus
              />
              <button 
                onClick={() => handleSaveCodAmount(cust.id, editingCodText)}
                className="px-2 py-0.5 rounded bg-emerald-500 text-black text-[10px] font-bold cursor-pointer shrink-0"
              >
                OK
              </button>
              <button 
                onClick={() => setEditingCodId(null)}
                className="p-1 rounded bg-neutral-800 text-neutral-400 cursor-pointer shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            cust.cod && cust.cod.trim() !== '' && cust.cod !== 'NO COD' && (cust.status !== 'modul2' || isModul2Today) ? (
              <div className="flex justify-between items-center border-t border-[#232328]/40 pt-1.5 mt-1">
                <span className="text-neutral-500 font-bold">Nominal COD:</span>
                <div className="flex items-center gap-1">
                  <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded ${
                    cust.paymentType === 'TF'
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                      : parseCodAmount(cust.cod) > 0
                        ? isModul2Today
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-[#C5A059]/10 text-[#D4AF37] border border-[#C5A059]/20'
                        : 'bg-neutral-800 text-neutral-400 border border-neutral-700/50'
                  }`}>
                    {cust.paymentType === 'TF'
                      ? `${parseCodAmount(cust.cod) > 0 ? formatRupiah(parseCodAmount(cust.cod)) : 'TF'} (TF Transfer)`
                      : parseCodAmount(cust.cod) > 0 ? formatRupiah(parseCodAmount(cust.cod)) : cust.cod}
                  </span>
                  <button 
                    onClick={() => {
                      setEditingCodId(cust.id);
                      setEditingCodText(cust.cod || '');
                    }}
                    className="p-1 rounded hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-all cursor-pointer"
                    title="Ubah Nominal COD"
                  >
                    <Edit2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            ) : null
          )}

          {/* Selesai timestamp info if in Modul 2 */}
          {cust.status === 'modul2' && (
            <div className="flex justify-between items-center text-[10px] border-t border-[#232328]/40 pt-1.5 mt-1">
              <span className="text-neutral-500 flex items-center gap-1">
                <Clock className={`w-3 h-3 ${isModul2Today ? 'text-emerald-400' : 'text-neutral-500'}`} /> Selesai:
              </span>
              <div className="flex items-center gap-1">
                <span className={`font-mono text-[10px] ${isModul2Today ? 'text-emerald-300 font-bold' : 'text-neutral-400'}`}>
                  {formatCompletedDate(cust.completedAt || cust.timestamp)}
                </span>
                {toggleCustomerCompletedDate && (
                  <button 
                    onClick={() => toggleCustomerCompletedDate(cust.id)}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-all cursor-pointer ${
                      isModul2Today
                        ? 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white border border-neutral-700'
                        : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 hover:text-white border border-emerald-500/30'
                    }`}
                    title={isModul2Today ? "Pindahkan ke Riwayat Sebelum Hari Ini" : "Pindahkan ke Sukses Hari Ini"}
                  >
                    {isModul2Today ? 'Ke Lalu' : 'Ke Hari Ini'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Options for Payment Type (Modul 2 & Modul 3) */}
          {(cust.status === 'modul3' || (cust.status === 'modul2' && isModul2Today)) && (cust.paymentType || (cust.cod && cust.cod.trim() !== '' && cust.cod !== 'NO COD' && parseCodAmount(cust.cod) > 0)) && (
            <div className="flex justify-between items-center mt-1 pt-1.5 border-t border-[#232328]/30">
              <span className="text-neutral-500 text-[10px] font-bold">Opsi Pembayaran:</span>
              <div className="flex rounded-md bg-neutral-900/80 p-0.5 border border-[#232328]">
                <button
                  onClick={() => updatePaymentType(cust.id, 'COD')}
                  className={`px-2.5 py-0.5 rounded text-[9px] font-black transition-all cursor-pointer ${
                    (cust.paymentType || 'COD') === 'COD'
                      ? 'bg-[#C5A059] text-black shadow font-extrabold'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  COD
                </button>
                <button
                  onClick={() => updatePaymentType(cust.id, 'TF')}
                  className={`px-2.5 py-0.5 rounded text-[9px] font-black transition-all cursor-pointer ${
                    cust.paymentType === 'TF'
                      ? 'bg-blue-500 text-white shadow font-extrabold'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  TF
                </button>
              </div>
            </div>
          )}

          {/* Captured temporary photos list inside Hold (Modul 3) only */}
          {cust.status === 'modul3' && (
            <div className="border-t border-[#232328]/50 pt-2.5 mt-2">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-neutral-400 font-bold flex items-center gap-1 text-[10px]">
                  <Camera className="w-3 h-3 text-[#C5A059]" /> FOTO BUKTI ({(cust.photos && cust.photos.length > 0) ? cust.photos.length : (cust.photoUrl ? 1 : 0)})
                </span>
                <button 
                  onClick={() => setCameraActiveForId(cust.id)}
                  className="text-[#D4AF37] hover:text-[#C5A059] text-[10px] font-bold flex items-center gap-1 cursor-pointer bg-[#C5A059]/10 px-2 py-0.5 rounded border border-[#C5A059]/20"
                >
                  <Plus className="w-3 h-3" /> Ambil / Tambah Foto
                </button>
              </div>

              {((cust.photos && cust.photos.length > 0) || cust.photoUrl) ? (
                <div className="grid grid-cols-4 gap-1.5 max-h-[72px] overflow-y-auto">
                  {(cust.photos && cust.photos.length > 0 ? cust.photos : [cust.photoUrl!]).map((p, idx) => {
                    const isSelected = selectedPhotos.some(item => item.id === cust.id && item.index === idx);
                    return (
                      <div 
                        key={`photo_${cust.id}_${idx}`} 
                        className={`relative aspect-square rounded-lg overflow-hidden bg-neutral-900 group/img transition-all ${
                          isSelected 
                            ? 'ring-2 ring-amber-500 ring-offset-2 ring-offset-black/50 border-transparent scale-95' 
                            : 'border border-[#232328]'
                        }`}
                      >
                        <img 
                          src={p} 
                          alt={`bukti ${idx}`}
                          className="w-full h-full object-cover cursor-pointer select-none"
                          referrerPolicy="no-referrer"
                          onClick={() => togglePhotoSelection(cust, p, idx)}
                        />
                        
                        <button
                          onClick={() => togglePhotoSelection(cust, p, idx)}
                          className={`absolute top-1 left-1 w-4.5 h-4.5 rounded-full flex items-center justify-center transition-all ${
                            isSelected 
                              ? 'bg-amber-500 text-black' 
                              : 'bg-black/60 text-white/50 border border-white/20 hover:border-white'
                          }`}
                        >
                          <Check className="w-3 h-3 stroke-[3]" />
                        </button>

                        <button 
                          onClick={() => deleteCustomerPhoto(cust.id, idx)}
                          className="absolute top-1 right-1 p-0.5 bg-black/60 hover:bg-red-600 rounded-full text-white transition-all cursor-pointer opacity-0 group-hover/img:opacity-100 sm:opacity-100"
                          title="Hapus foto"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>

                        <button
                          onClick={() => setLightboxPhoto(p)}
                          className="absolute bottom-1 right-1 p-0.5 bg-black/60 hover:bg-neutral-800 rounded text-neutral-300 hover:text-white transition-all cursor-pointer"
                          title="Perbesar foto"
                        >
                          <Eye className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div 
                  onClick={() => setCameraActiveForId(cust.id)}
                  className="border border-dashed border-[#232328] rounded-xl py-3 px-2 text-center text-neutral-600 text-[10px] cursor-pointer hover:border-[#C5A059]/50 transition-all flex flex-col items-center gap-1"
                >
                  <Camera className="w-4 h-4 text-neutral-600" />
                  <span>Tap untuk akses Kamera / Upload Foto Paket</span>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Card Footer Actions */}
        <div className="flex justify-between items-center mt-3 border-t border-[#232328]/40 pt-2 text-[10px]">
          <button 
            onClick={() => deleteCustomer(cust.id)}
            className="text-red-400/70 hover:text-red-400 flex items-center gap-1 transition-all cursor-pointer"
          >
            <Trash2 className="w-3 h-3" /> Hapus
          </button>

          <div className="flex items-center gap-2">
            {cust.status === 'modul1' ? (
              <>
                <button 
                  onClick={() => moveToModul3AndCapture(cust)}
                  className="text-amber-500 hover:text-amber-400 font-bold tracking-wide uppercase transition-all text-[9px] cursor-pointer"
                >
                  Hold (3)
                </button>
                <button 
                  onClick={() => moveToModul2(cust.id)}
                  className="text-[#D4AF37] hover:text-[#C5A059] flex items-center gap-1 font-bold tracking-wide uppercase transition-all text-[9px] cursor-pointer"
                >
                  Selesai (Success) <ChevronRight className="w-3 h-3" />
                </button>
              </>
            ) : cust.status === 'modul2' ? (
              <button 
                onClick={() => returnToModul1(cust.id)}
                className="text-neutral-500 hover:text-neutral-300 flex items-center gap-1 font-bold tracking-wide uppercase transition-all cursor-pointer"
              >
                <ChevronLeft className="w-3 h-3" /> Ke Sending
              </button>
            ) : (
              <>
                <button 
                  onClick={() => returnToModul1(cust.id)}
                  className="text-neutral-400 hover:text-neutral-200 font-bold tracking-wide uppercase transition-all text-[9px] cursor-pointer"
                >
                  Ke Sending
                </button>
                <button 
                  onClick={() => moveToModul2(cust.id)}
                  className="text-emerald-500 hover:text-emerald-400 font-bold tracking-wide uppercase transition-all text-[9px] flex items-center gap-0.5 cursor-pointer"
                >
                  Selesaikan <Check className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
        </div>

      </motion.div>
    </div>
  );
};
