import React from 'react';
import { Send, Search } from 'lucide-react';

interface InputDockProps {
  inputText: string;
  setInputText: (text: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  smartRoute: 'modul1' | 'modul2';
  handleProcessInput: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export const InputDock: React.FC<InputDockProps> = ({
  inputText,
  setInputText,
  searchQuery,
  setSearchQuery,
  smartRoute,
  handleProcessInput,
  textareaRef,
}) => {
  return (
    <div className="shrink-0 bg-[#0D0D0E] pt-1 pb-1">
      <div className="space-y-1.5">
        {/* Kolom Chat Pengiriman Data Customer */}
        <div className="flex items-center gap-1.5 bg-[#18181B] rounded-xl p-1.5 border border-[#232328] shadow-inner focus-within:border-[#C5A059]/60 transition-all">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Tempel data kurir / nama..."
            rows={1}
            className="flex-1 bg-transparent border-0 outline-none focus:ring-0 text-xs text-white max-h-[60px] py-1 px-2 resize-none placeholder-neutral-500 overflow-y-auto"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleProcessInput();
              }
            }}
          />
          <div className="flex flex-col items-end gap-1 shrink-0">
            <button
              onClick={handleProcessInput}
              disabled={!inputText.trim()}
              className="p-2 rounded-lg bg-[#C5A059] text-black hover:bg-[#D4AF37] disabled:opacity-30 disabled:hover:bg-[#C5A059] transition-all cursor-pointer shadow flex items-center justify-center font-bold"
              title="Kirim / Proses Data Customer"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Pencarian Cepat Bar */}
        <div className="relative">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-3.5 w-3.5 text-neutral-500" />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari cepat (nama, hp, alamat, cod)..."
            className="w-full pl-9 pr-8 py-1.5 text-xs bg-[#18181B] text-white rounded-xl border border-[#232328] focus:border-[#C5A059] focus:ring-1 focus:ring-[#C5A059] outline-none transition-all placeholder-neutral-500"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-xs text-neutral-400 hover:text-white cursor-pointer font-bold"
              title="Reset Pencarian"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
