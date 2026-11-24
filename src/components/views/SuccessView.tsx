import React from 'react';
import { Sparkles, RotateCcw, Clock } from 'lucide-react';
import { Customer, TempatCodLocation, CustomerChatHistoryInfo } from '../../types';
import { CustomerCard } from '../CustomerCard';
import { formatRupiah, isToday, sumPackageCounts, parseCodAmount, getPackageCount, deduplicateById, cleanPhoneNumber } from '../../utils/helpers';

interface SuccessViewProps {
  filteredCustomers: Customer[];
  allSuccessList: Customer[];
  todaySuccessList: Customer[];
  codTodayNominal: number;
  setShowResetModal: (show: boolean) => void;
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
  toggleCustomerCompletedDate: (id: string) => void;
  customerChatHistoryMap?: Record<string, CustomerChatHistoryInfo>;
  checkingWaCustomerId?: string | null;
}

export const SuccessView: React.FC<SuccessViewProps> = ({
  filteredCustomers,
  allSuccessList,
  todaySuccessList,
  codTodayNominal,
  setShowResetModal,
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
  customerChatHistoryMap,
  checkingWaCustomerId,
}) => {
  const todayItems = deduplicateById(
    [...filteredCustomers]
      .filter(c => isToday(c.completedAt || c.timestamp))
      .sort((a, b) => {
        const timeA = a.completedAt || a.timestamp || 0;
        const timeB = b.completedAt || b.timestamp || 0;
        if (timeB !== timeA) return timeB - timeA;
        return (b.originalIndex || 0) - (a.originalIndex || 0);
      })
  );

  const previousItems = deduplicateById(
    [...filteredCustomers]
      .filter(c => !isToday(c.completedAt || c.timestamp))
      .sort((a, b) => {
        const timeA = a.completedAt || a.timestamp || 0;
        const timeB = b.completedAt || b.timestamp || 0;
        if (timeB !== timeA) return timeB - timeA;
        return (b.originalIndex || 0) - (a.originalIndex || 0);
      })
  );

  return (
    <div className="space-y-4">
      {/* SUCCESS SUMMARY CARD & RESET CONTROL */}
      <div className="bg-[#141416] border border-[#232328] rounded-2xl p-3 space-y-2.5 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#232328] pb-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-black text-white uppercase tracking-wider">
                Ringkasan Sukses &amp; COD Masuk
              </h3>
              <p className="text-[10px] text-neutral-400">
                Total nominal pembayaran COD dari kiriman sukses
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowResetModal(true)}
            className="px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-amber-300 hover:text-amber-200 border border-amber-500/30 text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
            title="Reset atau atur hitungan data sukses"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
            <span>Reset / Atur Hitungan</span>
          </button>
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <div className="bg-[#18181B] border border-emerald-500/25 rounded-xl p-2.5">
            <div className="flex items-center justify-between text-[10px] text-neutral-400 font-medium">
              <span>Sukses Hari Ini:</span>
              <span className="font-bold text-emerald-400">{sumPackageCounts(todaySuccessList)} Paket</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-1">
              <span className="text-[10px] text-neutral-500">COD Masuk Hari Ini:</span>
              <span className="text-xs sm:text-sm font-black text-emerald-300 font-mono">
                {formatRupiah(codTodayNominal)}
              </span>
            </div>
          </div>

          <div className="bg-[#18181B] border border-neutral-800 rounded-xl p-2.5">
            <div className="flex items-center justify-between text-[10px] text-neutral-400 font-medium">
              <span>Riwayat Lalu:</span>
              <span className="font-bold text-neutral-300">{sumPackageCounts(allSuccessList) - sumPackageCounts(todaySuccessList)} Paket</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-1">
              <span className="text-[10px] text-neutral-500">Total Data Tersimpan:</span>
              <span className="text-xs sm:text-sm font-bold text-neutral-200 font-mono">
                {sumPackageCounts(allSuccessList)} Paket
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 1: SUKSES HARI INI */}
      <div className="space-y-2">
        <div className="flex items-center justify-between bg-emerald-950/40 border border-emerald-500/30 rounded-xl px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              Sukses Hari Ini
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-emerald-400/90 font-mono">
              COD: {formatRupiah(codTodayNominal)}
            </span>
            <span className="text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
              {sumPackageCounts(todayItems)} Paket
            </span>
          </div>
        </div>

        {todayItems.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {(() => {
              let runningSeq = 1;
              return todayItems.map((cust) => {
                const cardSeq = runningSeq;
                runningSeq += getPackageCount(cust);
                return (
                  <CustomerCard
                    key={`today_${cust.id}`}
                    cust={cust}
                    displayIndex={cardSeq}
                    activeTab="modul2"
                    tempatCodList={tempatCodList}
                    editingCodId={editingCodId}
                    editingCodText={editingCodText}
                    setEditingCodId={setEditingCodId}
                    setEditingCodText={setEditingCodText}
                    handleSaveCodAmount={handleSaveCodAmount}
                    handleWhatsAppChat={handleWhatsAppChat}
                    setDropOffModalCustomer={setDropOffModalCustomer}
                    updatePaymentType={updatePaymentType}
                    setCameraActiveForId={setCameraActiveForId}
                    selectedPhotos={selectedPhotos}
                    togglePhotoSelection={togglePhotoSelection}
                    deleteCustomerPhoto={deleteCustomerPhoto}
                    setLightboxPhoto={setLightboxPhoto}
                    deleteCustomer={deleteCustomer}
                    moveToModul2={moveToModul2}
                    moveToModul3AndCapture={moveToModul3AndCapture}
                    returnToModul1={returnToModul1}
                    toggleCustomerCompletedDate={toggleCustomerCompletedDate}
                    chatHistory={customerChatHistoryMap?.[cust.cleanPhone || cleanPhoneNumber(cust.phone || '')]}
                    isCheckingWa={checkingWaCustomerId === cust.id}
                  />
                );
              });
            })()}
          </div>
        ) : (
          <div className="text-center py-3 bg-neutral-900/40 rounded-xl border border-neutral-800/60 text-neutral-500 text-[11px]">
            Belum ada data paket sukses untuk hari ini.
          </div>
        )}
      </div>

      {/* VISUAL SEPARATOR DIVIDER */}
      <div className="relative py-1 flex items-center justify-center my-2">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[#232328]" />
        </div>
        <span className="relative px-3 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-[#0D0D0E] text-neutral-500 rounded-full border border-[#232328] flex items-center gap-1.5">
          <Clock className="w-2.5 h-2.5" /> Riwayat Sebelum Hari Ini
        </span>
      </div>

      {/* SECTION 2: SUKSES DATA SEBELUMNYA */}
      <div className="space-y-2">
        <div className="flex items-center justify-between bg-[#141416] border border-[#232328] rounded-xl px-3 py-2">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-neutral-400" />
            <span className="text-xs font-bold text-neutral-300">
              Sukses Data Sebelumnya
            </span>
          </div>
          <span className="text-[10px] font-bold bg-neutral-800 text-neutral-400 px-2.5 py-0.5 rounded-full border border-neutral-700">
            {sumPackageCounts(previousItems)} Paket
          </span>
        </div>

        {previousItems.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 opacity-95">
            {(() => {
              let runningSeq = 1;
              return previousItems.map((cust) => {
                const cardSeq = runningSeq;
                runningSeq += getPackageCount(cust);
                return (
                  <CustomerCard
                    key={`prev_${cust.id}`}
                    cust={cust}
                    displayIndex={cardSeq}
                    activeTab="modul2"
                    tempatCodList={tempatCodList}
                    editingCodId={editingCodId}
                    editingCodText={editingCodText}
                    setEditingCodId={setEditingCodId}
                    setEditingCodText={setEditingCodText}
                    handleSaveCodAmount={handleSaveCodAmount}
                    handleWhatsAppChat={handleWhatsAppChat}
                    setDropOffModalCustomer={setDropOffModalCustomer}
                    updatePaymentType={updatePaymentType}
                    setCameraActiveForId={setCameraActiveForId}
                    selectedPhotos={selectedPhotos}
                    togglePhotoSelection={togglePhotoSelection}
                    deleteCustomerPhoto={deleteCustomerPhoto}
                    setLightboxPhoto={setLightboxPhoto}
                    deleteCustomer={deleteCustomer}
                    moveToModul2={moveToModul2}
                    moveToModul3AndCapture={moveToModul3AndCapture}
                    returnToModul1={returnToModul1}
                    toggleCustomerCompletedDate={toggleCustomerCompletedDate}
                    chatHistory={customerChatHistoryMap?.[cust.cleanPhone || cleanPhoneNumber(cust.phone || '')]}
                    isCheckingWa={checkingWaCustomerId === cust.id}
                  />
                );
              });
            })()}
          </div>
        ) : (
          <div className="text-center py-3 bg-neutral-900/40 rounded-xl border border-neutral-800/60 text-neutral-500 text-[11px]">
            Tidak ada data paket sukses dari hari sebelumnya.
          </div>
        )}
      </div>

    </div>
  );
};
