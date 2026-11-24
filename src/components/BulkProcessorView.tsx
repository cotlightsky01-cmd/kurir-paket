import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Play, 
  Square,
  RotateCcw,
  RefreshCw,
  Trash2, 
  Send, 
  Loader2, 
  GripVertical, 
  Copy, 
  Check, 
  Pencil, 
  Save, 
  X as CloseIcon, 
  Package 
} from 'lucide-react';
import { extractBatchData } from '../services/gemini';
import { cn } from '../lib/utils';
import { BulkItem, Customer } from '../types';
import { 
  cleanPhoneNumber, 
  compressImageDataUrl, 
  cleanAddressText,
  cleanPureName,
  deduplicateById,
  insertCustomerPreservingOrder
} from '../utils/helpers';

interface BulkProcessorViewProps {
  bulkItems: BulkItem[];
  setBulkItems?: React.Dispatch<React.SetStateAction<BulkItem[]>>;
  customers?: Customer[];
  setCustomers?: React.Dispatch<React.SetStateAction<Customer[]>>;
  addBulkItems?: (urls: string[]) => void;
  updateBulkItem?: (id: string, data: Partial<BulkItem>) => void;
  reorderBulkItem?: (id: string, newOrder: number) => void;
  clearBulkItems?: () => void;
  syncAddresses?: (items: BulkItem[]) => void;
  onNavigateToSending?: () => void;
  onClearFilling?: () => void;
}

export const BulkProcessorView: React.FC<BulkProcessorViewProps> = ({
  bulkItems,
  setBulkItems,
  customers,
  setCustomers,
  addBulkItems,
  updateBulkItem,
  reorderBulkItem,
  clearBulkItems,
  syncAddresses,
  onNavigateToSending,
  onClearFilling
}) => {
  const [processing, setProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [isSending, setIsSending] = useState(false);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState({ 
    name: '', 
    phone: '', 
    address: '', 
    cod_amount: '', 
    package_count: '' 
  });
  const [exitVectors, setExitVectors] = useState<Record<string, { x: number; y: number; rotate: number }>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);

  const bulkItemsRef = useRef<BulkItem[]>(bulkItems);
  bulkItemsRef.current = bulkItems;
  const sendNoticeTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const longPressTimerRef = useRef<number | null>(null);
  const longPressMetaRef = useRef<{
    itemId: string;
    pointerId: number;
    startX: number;
    startY: number;
    lastClientY: number;
  } | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const dragAnchorClientYRef = useRef(0);
  const dragAnchorScrollTopRef = useRef(0);
  const lastClientYRef = useRef(0);
  const dragOffsetYRef = useRef(0);
  const pendingOffsetTopAnchorRef = useRef<number | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);

  const processFiles = (files: File[]) => {
    if (files.length === 0) return;
    
    // Read files as Data URLs and compress them for light storage
    const promises = files.slice(0, 100).map(file => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = async () => {
          const result = reader.result as string;
          const compressed = await compressImageDataUrl(result);
          resolve(compressed);
        };
        reader.readAsDataURL(file);
      });
    });

    Promise.all(promises).then(urls => {
      handleAddBulkItems(urls);
      if (fileInputRef.current) fileInputRef.current.value = '';
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    processFiles(files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const imageFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      processFiles(imageFiles);
    }
  };

  // Listen for paste event anywhere in Filling view
  React.useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items);
      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        processFiles(imageFiles);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [bulkItems]);

  // Helper functions that safely fallback to setBulkItems / setCustomers
  const handleAddBulkItems = (urls: string[]) => {
    if (addBulkItems) {
      addBulkItems(urls);
    } else if (setBulkItems) {
      const now = Date.now();
      const randStr = Math.random().toString(36).substring(2, 7);
      setBulkItems(prev => {
        const cleanPrev = deduplicateById(prev);
        const existingBatchId = cleanPrev.find(item => item.fillingBatchId)?.fillingBatchId;
        const activeBatchId = existingBatchId || `fbatch_${now}_${randStr}`;
        const maxOrder = cleanPrev.reduce((max, item) => Math.max(max, Number(item.order) || 0), 0);
        const startOrder = maxOrder + 1;
        const newItems: BulkItem[] = urls.map((url, idx) => ({
          id: `fill_${now}_${randStr}_${idx}`,
          order: startOrder + idx,
          image_url: url,
          status: 'pending',
          fillingBatchId: activeBatchId,
        }));
        return [...cleanPrev, ...newItems];
      });
    }
  };

  const handleUpdateBulkItem = (id: string, data: Partial<BulkItem>) => {
    if (updateBulkItem) {
      updateBulkItem(id, data);
    } else if (setBulkItems) {
      setBulkItems(prev => prev.map(item => item.id === id ? { ...item, ...data } : item));
    }
  };

  const handleReorderBulkItem = (id: string, newOrder: number) => {
    if (reorderBulkItem) {
      reorderBulkItem(id, newOrder);
    } else if (setBulkItems) {
      setBulkItems(prev => prev.map(item => item.id === id ? { ...item, order: newOrder, is_reordered: true } : item));
    }
  };

  const sortedItems = deduplicateById(bulkItems).sort((a, b) => a.order - b.order);
  const sortedItemsRef = useRef<BulkItem[]>(sortedItems);
  sortedItemsRef.current = sortedItems;

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const stopCardDrag = useCallback(() => {
    clearLongPressTimer();
    longPressMetaRef.current = null;
    if (autoScrollRafRef.current !== null) {
      window.cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
    if (draggingIdRef.current !== null) {
      draggingIdRef.current = null;
      pendingOffsetTopAnchorRef.current = null;
      dragOffsetYRef.current = 0;
      setDraggingId(null);
      setDragOffsetY(0);
    }
  }, [clearLongPressTimer]);

  const moveBulkItemToIndex = useCallback((itemId: string, toIndex: number) => {
    if (!setBulkItems) return;
    setBulkItems(prev => {
      const ordered = deduplicateById(prev).sort((a, b) => a.order - b.order);
      const fromIndex = ordered.findIndex(item => item.id === itemId);
      if (fromIndex === -1 || toIndex < 0 || toIndex >= ordered.length || fromIndex === toIndex) {
        return prev;
      }
      // Preserve existing order slot numbers so partially-sent batches keep non-colliding Filling orders
      const sortedOrderSlots = ordered
        .map((item, index) => (typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : index + 1))
        .sort((a, b) => a - b);
      const next = [...ordered];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next.map((item, index) => ({
        ...item,
        order: sortedOrderSlots[index] ?? (index + 1)
      }));
    });
  }, [setBulkItems]);

  const updateDragPosition = useCallback((clientY: number) => {
    const activeId = draggingIdRef.current;
    if (!activeId) return;

    lastClientYRef.current = clientY;
    const container = listContainerRef.current;
    const scrollDelta = container ? container.scrollTop - dragAnchorScrollTopRef.current : 0;
    const nextOffset = (clientY - dragAnchorClientYRef.current) + scrollDelta;
    dragOffsetYRef.current = nextOffset;
    setDragOffsetY(nextOffset);

    // Wait for any pending post-swap offsetTop compensation before checking the next swap
    if (pendingOffsetTopAnchorRef.current !== null) return;

    const currentOrdered = sortedItemsRef.current;
    const currentIndex = currentOrdered.findIndex(item => item.id === activeId);
    if (currentIndex === -1) return;

    const draggedEl = cardRefs.current.get(activeId);
    if (!draggedEl) return;

    const draggedVisualCenterY = draggedEl.offsetTop + nextOffset + draggedEl.offsetHeight / 2;

    if (currentIndex < currentOrdered.length - 1) {
      const nextItem = currentOrdered[currentIndex + 1];
      const nextEl = cardRefs.current.get(nextItem.id);
      if (nextEl) {
        const nextMidY = nextEl.offsetTop + nextEl.offsetHeight / 2;
        if (draggedVisualCenterY > nextMidY + 6) {
          pendingOffsetTopAnchorRef.current = draggedEl.offsetTop;
          moveBulkItemToIndex(activeId, currentIndex + 1);
          return;
        }
      }
    }

    if (currentIndex > 0) {
      const prevItem = currentOrdered[currentIndex - 1];
      const prevEl = cardRefs.current.get(prevItem.id);
      if (prevEl) {
        const prevMidY = prevEl.offsetTop + prevEl.offsetHeight / 2;
        if (draggedVisualCenterY < prevMidY - 6) {
          pendingOffsetTopAnchorRef.current = draggedEl.offsetTop;
          moveBulkItemToIndex(activeId, currentIndex - 1);
        }
      }
    }
  }, [moveBulkItemToIndex]);

  useLayoutEffect(() => {
    const activeId = draggingIdRef.current;
    if (!activeId || pendingOffsetTopAnchorRef.current === null) return;

    const el = cardRefs.current.get(activeId);
    if (el) {
      const delta = el.offsetTop - pendingOffsetTopAnchorRef.current;
      if (delta !== 0) {
        dragAnchorClientYRef.current += delta;
        const container = listContainerRef.current;
        const scrollDelta = container ? container.scrollTop - dragAnchorScrollTopRef.current : 0;
        const compensatedOffset = (lastClientYRef.current - dragAnchorClientYRef.current) + scrollDelta;
        dragOffsetYRef.current = compensatedOffset;
        setDragOffsetY(compensatedOffset);
      }
    }
    pendingOffsetTopAnchorRef.current = null;
  }, [sortedItems]);

  const activateCardDrag = useCallback((itemId: string, clientY: number) => {
    clearLongPressTimer();
    const container = listContainerRef.current;
    draggingIdRef.current = itemId;
    dragAnchorClientYRef.current = clientY;
    dragAnchorScrollTopRef.current = container ? container.scrollTop : 0;
    lastClientYRef.current = clientY;
    dragOffsetYRef.current = 0;
    pendingOffsetTopAnchorRef.current = null;
    setDraggingId(itemId);
    setDragOffsetY(0);

    try {
      navigator.vibrate?.(30);
    } catch {
      // Ignore vibration errors on unsupported browsers
    }
  }, [clearLongPressTimer]);

  const handleCardPointerDown = (e: React.PointerEvent<HTMLDivElement>, itemId: string) => {
    if (isSending || isClearingAll || editingId === itemId || sortedItemsRef.current.length <= 1) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const target = e.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, select, a, label')) return;

    clearLongPressTimer();
    const startX = e.clientX;
    const startY = e.clientY;
    const isGripHandle = Boolean(target?.closest('[data-drag-handle="true"]'));

    longPressMetaRef.current = {
      itemId,
      pointerId: e.pointerId,
      startX,
      startY,
      lastClientY: startY
    };

    const delayMs = isGripHandle ? 140 : 350;
    longPressTimerRef.current = window.setTimeout(() => {
      const meta = longPressMetaRef.current;
      if (meta && meta.itemId === itemId) {
        activateCardDrag(itemId, meta.lastClientY);
      }
    }, delayMs);
  };

  useEffect(() => {
    const handleWindowPointerMove = (e: PointerEvent) => {
      if (draggingIdRef.current) {
        updateDragPosition(e.clientY);
        return;
      }
      const meta = longPressMetaRef.current;
      if (meta && e.pointerId === meta.pointerId) {
        meta.lastClientY = e.clientY;
        const dist = Math.hypot(e.clientX - meta.startX, e.clientY - meta.startY);
        if (dist > 8) {
          clearLongPressTimer();
          longPressMetaRef.current = null;
        }
      }
    };

    const handleWindowTouchMove = (e: TouchEvent) => {
      if (draggingIdRef.current) {
        if (e.cancelable) e.preventDefault();
        const touch = e.touches[0];
        if (touch) {
          updateDragPosition(touch.clientY);
        }
        return;
      }
      const meta = longPressMetaRef.current;
      if (meta && e.touches[0]) {
        const touch = e.touches[0];
        meta.lastClientY = touch.clientY;
        const dist = Math.hypot(touch.clientX - meta.startX, touch.clientY - meta.startY);
        if (dist > 8) {
          clearLongPressTimer();
          longPressMetaRef.current = null;
        }
      }
    };

    const handleWindowEnd = () => {
      stopCardDrag();
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
    window.addEventListener('pointerup', handleWindowEnd);
    window.addEventListener('pointercancel', handleWindowEnd);
    window.addEventListener('touchend', handleWindowEnd);
    window.addEventListener('touchcancel', handleWindowEnd);
    window.addEventListener('blur', handleWindowEnd);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('touchmove', handleWindowTouchMove);
      window.removeEventListener('pointerup', handleWindowEnd);
      window.removeEventListener('pointercancel', handleWindowEnd);
      window.removeEventListener('touchend', handleWindowEnd);
      window.removeEventListener('touchcancel', handleWindowEnd);
      window.removeEventListener('blur', handleWindowEnd);
      clearLongPressTimer();
    };
  }, [clearLongPressTimer, stopCardDrag, updateDragPosition]);

  useEffect(() => {
    if (!draggingId) return;

    const tickAutoScroll = () => {
      const container = listContainerRef.current;
      if (container && draggingIdRef.current) {
        const rect = container.getBoundingClientRect();
        const edgeThreshold = 52;
        const pointerY = lastClientYRef.current;
        let scrollStep = 0;

        if (pointerY < rect.top + edgeThreshold && container.scrollTop > 0) {
          const ratio = Math.min(1, (rect.top + edgeThreshold - pointerY) / edgeThreshold);
          scrollStep = -Math.max(2, Math.round(ratio * 10));
        } else if (
          pointerY > rect.bottom - edgeThreshold &&
          container.scrollTop < container.scrollHeight - container.clientHeight
        ) {
          const ratio = Math.min(1, (pointerY - (rect.bottom - edgeThreshold)) / edgeThreshold);
          scrollStep = Math.max(2, Math.round(ratio * 10));
        }

        if (scrollStep !== 0) {
          container.scrollTop += scrollStep;
          updateDragPosition(pointerY);
        }
      }
      autoScrollRafRef.current = window.requestAnimationFrame(tickAutoScroll);
    };

    autoScrollRafRef.current = window.requestAnimationFrame(tickAutoScroll);
    return () => {
      if (autoScrollRafRef.current !== null) {
        window.cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };
  }, [draggingId, updateDragPosition]);

  const handleClearAllFilling = async () => {
    if (bulkItems.length === 0 || isClearingAll) return;

    // Immediately stop any generate loops
    isPausedRef.current = true;
    setIsPaused(true);
    setProcessing(false);

    setIsClearingAll(true);

    const itemsToClear = [...bulkItems].sort((a, b) => a.order - b.order);

    const directions = [
      { x: -350, y: -60, rotate: -25 },
      { x: 350, y: -40, rotate: 25 },
      { x: -300, y: 100, rotate: -35 },
      { x: 300, y: 80, rotate: 30 },
      { x: -400, y: -20, rotate: -15 },
      { x: 400, y: 20, rotate: 20 },
      { x: 0, y: -280, rotate: -20 },
      { x: 0, y: 280, rotate: 20 },
    ];

    const newVectors: Record<string, { x: number; y: number; rotate: number }> = {};
    itemsToClear.forEach((item, index) => {
      const dir = directions[(index + Math.floor(Math.random() * directions.length)) % directions.length];
      newVectors[item.id] = dir;
    });
    setExitVectors(newVectors);

    for (let i = 0; i < itemsToClear.length; i++) {
      const itemId = itemsToClear[i].id;
      if (setBulkItems) {
        setBulkItems(prev => prev.filter(b => b.id !== itemId));
      }
      await new Promise(r => setTimeout(r, 65));
    }

    await new Promise(r => setTimeout(r, 200));
    setSendNotice(null);
    if (onClearFilling) onClearFilling();
    if (clearBulkItems) clearBulkItems();
    setIsClearingAll(false);
  };

  // SEND FUNCTIONALITY: Only sends items with status === 'completed',
  // leaves unfinished items in Filling so generation continues uninterrupted,
  // and preserves original Filling batch order when sent in multiple stages.
  const handleSendAllToSending = async () => {
    const currentSnapshot = deduplicateById(bulkItemsRef.current);
    const itemsToSend = currentSnapshot
      .filter(item => item.status === 'completed')
      .sort((a, b) => a.order - b.order);

    if (itemsToSend.length === 0 || isSending) return;

    setIsSending(true);
    if (sendNoticeTimerRef.current !== null) {
      window.clearTimeout(sendNoticeTimerRef.current);
      sendNoticeTimerRef.current = null;
    }

    // Ensure all items in this Filling session share one consistent fillingBatchId
    // so later partial sends slot right back into their original positions in Sending.
    const existingBatchId = currentSnapshot.find(b => b.fillingBatchId)?.fillingBatchId;
    const activeBatchId = existingBatchId || `fbatch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (setBulkItems) {
      setBulkItems(prev =>
        prev.map(b => (b.fillingBatchId ? b : { ...b, fillingBatchId: activeBatchId }))
      );
    }

    const sentIds = new Set<string>();

    for (let i = 0; i < itemsToSend.length; i++) {
      const item = itemsToSend[i];
      sentIds.add(item.id);

      const rawName = cleanPureName(item.name?.trim() || '') || 'Tanpa Nama';
      const cleanAddr = cleanAddressText(item.address?.trim() || '') || 'Data Filling';
      const rawPhone = item.phone?.trim() || '';
      const cleanPh = cleanPhoneNumber(rawPhone);

      const pkgCount = item.package_count ? Number(item.package_count) || 1 : 1;

      const newCustomer: Customer = {
        id: `cust_${item.id}_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
        originalIndex: item.order || (customers?.length || 0) + 1,
        name: rawName,
        phone: rawPhone,
        cleanPhone: cleanPh.length >= 8 ? cleanPh : '',
        address: cleanAddr,
        cod: item.cod_amount?.trim() || 'NO COD',
        packageCount: pkgCount,
        package_count: pkgCount,
        status: 'modul1',
        photos: [],
        timestamp: Date.now() + i,
        fillingBatchId: item.fillingBatchId || activeBatchId,
        fillingOrder: item.order,
      };

      if (setCustomers) {
        setCustomers(prev => insertCustomerPreservingOrder(prev, newCustomer));
      } else if (syncAddresses) {
        syncAddresses([item]);
      }

      // Remove only this completed item from bulkItems so Framer Motion triggers exit animation
      // while unfinished items stay in Filling and continue generating.
      if (setBulkItems) {
        setBulkItems(prev =>
          prev
            .filter(b => b.id !== item.id)
            .map(b => (b.fillingBatchId ? b : { ...b, fillingBatchId: activeBatchId }))
        );
      }

      // Fast stagger delay between items
      await new Promise(res => setTimeout(res, 60));
    }

    // Small delay after last item slides out
    await new Promise(res => setTimeout(res, 120));
    const remainingItems = bulkItemsRef.current.filter(b => !sentIds.has(b.id));
    setIsSending(false);

    if (remainingItems.length === 0) {
      setSendNotice(null);
      if (onNavigateToSending) {
        onNavigateToSending();
      }
    } else {
      setSendNotice(
        `${itemsToSend.length} data selesai dikirim ke Sending. ${remainingItems.length} data masih diproses di Filling.`
      );
      sendNoticeTimerRef.current = window.setTimeout(() => {
        setSendNotice(null);
        sendNoticeTimerRef.current = null;
      }, 4500);
    }
  };

  const startEditing = (item: BulkItem) => {
    setEditingId(item.id);
    setEditData({
      name: item.name || '',
      phone: item.phone || '',
      address: item.address || '',
      cod_amount: item.cod_amount || 'NO COD',
      package_count: item.package_count ? String(item.package_count) : ''
    });
  };

  const saveEdit = () => {
    if (editingId) {
      handleUpdateBulkItem(editingId, editData);
      setEditingId(null);
    }
  };

  const handleStop = async () => {
    isPausedRef.current = true;
    setIsPaused(true);
    setProcessing(false);

    if (setBulkItems) {
      setBulkItems(prev => prev.map(item => item.status === 'processing' ? { ...item, status: 'pending' } : item));
    }
  };

  const handleRegenerateSingleItem = async (item: BulkItem) => {
    if (regeneratingIds.has(item.id)) return;

    // Check if image_url is missing or optimized/stored locally
    if (!item.image_url || !item.image_url.startsWith('data:image')) {
      if (item.name || item.address || item.phone) {
        handleUpdateBulkItem(item.id, { status: 'completed', image_url: '', error_message: '' });
      } else {
        handleUpdateBulkItem(item.id, { error_message: 'Gambar asli tidak tersedia untuk di-generate ulang' });
      }
      return;
    }

    setRegeneratingIds(prev => {
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });

    handleUpdateBulkItem(item.id, { status: 'processing', error_message: '' });

    try {
      const urlParts = item.image_url.split(',');
      const mimeType = urlParts[0]?.match(/:(.*?);/)?.[1] || 'image/jpeg';
      const base64Data = urlParts[1] || '';

      const results = await extractBatchData([{ data: base64Data, mimeType }]);
      const data = results[0];

      if (data && !data.error && (data.name || data.address || data.phone)) {
        handleUpdateBulkItem(item.id, {
          name: cleanPureName(data.name || ''),
          phone: data.phone || '',
          address: cleanAddressText(data.address || ''),
          cod_amount: data.cod_amount || 'NO COD',
          package_count: data.package_count || '1',
          status: 'completed',
          image_url: '',
          error_message: ''
        });
      } else {
        handleUpdateBulkItem(item.id, {
          status: 'pending',
          error_message: data?.error || 'Gagal mengekstrak data'
        });
      }
    } catch (err: any) {
      console.error('Single item regenerate error:', err);
      handleUpdateBulkItem(item.id, {
        status: 'pending',
        error_message: err?.message || 'Gagal mengekstrak'
      });
    } finally {
      setRegeneratingIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleProcess = async () => {
    if (bulkItems.length === 0) return;
    isPausedRef.current = false;
    setIsPaused(false);
    setProcessing(true);

    const itemsToProcess = bulkItems.filter(item => {
      if (item.status === 'completed') return false;
      
      // If item already has extracted data (name, address, or phone), lock its status as 'completed' and skip re-generate
      const hasData = Boolean(
        (item.name && item.name.trim() !== '' && item.name !== 'Tanpa Nama' && item.name !== 'Pelanggan') ||
        (item.address && item.address.trim() !== '') ||
        (item.phone && item.phone.trim() !== '')
      );

      const isImageUnavailable = !item.image_url || !item.image_url.startsWith('data:image');

      if (hasData || isImageUnavailable) {
        handleUpdateBulkItem(item.id, { status: 'completed', image_url: '' });
        return false;
      }
      return true;
    });

    if (itemsToProcess.length === 0) {
      setProcessing(false);
      return;
    }

    // 1. Mark status as 'processing' for pending items
    itemsToProcess.forEach(item => handleUpdateBulkItem(item.id, { status: 'processing', error_message: '' }));

    // 2. Dual workers: Pekerja 1 (top-to-bottom) & Pekerja 2 (bottom-to-top) without collisions
    const claimedIds = new Set<string>();

    itemsToProcess.sort((a, b) => a.order - b.order);

    const getNextUnclaimedItem = (direction: 'top' | 'bottom'): BulkItem | null => {
      if (direction === 'top') {
        for (let i = 0; i < itemsToProcess.length; i++) {
          const item = itemsToProcess[i];
          if (!claimedIds.has(item.id)) {
            claimedIds.add(item.id);
            return item;
          }
        }
      } else {
        for (let i = itemsToProcess.length - 1; i >= 0; i--) {
          const item = itemsToProcess[i];
          if (!claimedIds.has(item.id)) {
            claimedIds.add(item.id);
            return item;
          }
        }
      }
      return null;
    };

    const worker = async (workerId: number, direction: 'top' | 'bottom') => {
      if (workerId > 0) {
        await new Promise(r => setTimeout(r, 500));
      }

      while (!isPausedRef.current) {
        const item = getNextUnclaimedItem(direction);
        if (!item) break; // All items claimed / queue empty

        // ALWAYS verify before extracting/generating if data is ALREADY obtained in current state
        let isAlreadyObtained = false;
        if (setBulkItems) {
          setBulkItems(prev => {
            const fresh = prev.find(b => b.id === item.id);
            if (fresh) {
              const hasData = Boolean(
                fresh.status === 'completed' ||
                (fresh.name && fresh.name.trim() !== '' && fresh.name !== 'Tanpa Nama' && fresh.name !== 'Pelanggan') ||
                (fresh.address && fresh.address.trim() !== '') ||
                (fresh.phone && fresh.phone.trim() !== '') ||
                (!fresh.image_url || !fresh.image_url.startsWith('data:image'))
              );
              if (hasData) {
                isAlreadyObtained = true;
              }
            }
            return prev;
          });
        }

        if (isAlreadyObtained) {
          console.log(`[Client Worker ${workerId} (${direction})] Item ${item.id} ALREADY has data obtained or image unavailable. Skipping generate!`);
          handleUpdateBulkItem(item.id, { status: 'completed', image_url: '' });
          continue;
        }

        let success = false;
        let attempts = 0;
        const maxWorkerAttempts = 2; // Worker tries twice before handing off

        while (!success && attempts < maxWorkerAttempts) {
          if (isPausedRef.current) break;
          attempts++;
          try {
            const urlParts = item.image_url.split(',');
            const mimeType = urlParts[0]?.match(/:(.*?);/)?.[1] || 'image/jpeg';
            const base64Data = urlParts[1] || '';

            const results = await extractBatchData([{ data: base64Data, mimeType }]);
            if (isPausedRef.current) break;

            const data = results[0];

            if (data && !data.error && (data.name || data.address || data.phone)) {
              handleUpdateBulkItem(item.id, {
                name: cleanPureName(data.name || ''),
                phone: data.phone || '',
                address: cleanAddressText(data.address || ''),
                cod_amount: data.cod_amount || 'NO COD',
                package_count: data.package_count || '1',
                status: 'completed',
                image_url: '',
                error_message: ''
              });
              success = true;
            } else {
              if (isPausedRef.current) break;
              console.warn(`[Client Worker ${workerId} (${direction})] Attempt ${attempts} failed for item ${item.id}. Pausing 2s temporarily...`);
              await new Promise(r => setTimeout(r, 2000));
            }
          } catch (err) {
            if (isPausedRef.current) break;
            console.error(`[Client Worker ${workerId} (${direction})] Error processing item ${item.id}:`, err);
            await new Promise(r => setTimeout(r, 2500));
          }
        }

        if (isPausedRef.current) break;

        if (success) {
          // Pause 600ms before picking up next item
          await new Promise(r => setTimeout(r, 600));
        } else {
          if (isPausedRef.current) break;
          // Worker failed/touched limit: pause and unclaim so another worker can attempt if needed
          const requeues = (item as any)._requeues || 0;
          if (requeues < 5) {
            console.warn(`[Client Worker ${workerId} (${direction})] Item ${item.id} touched limit. Pausing 3s before releasing claim...`);
            await new Promise(r => setTimeout(r, 3000));
            if (isPausedRef.current) break;
            (item as any)._requeues = requeues + 1;
            claimedIds.delete(item.id);
          } else {
            // Safety fallback if reached max requeues
            handleUpdateBulkItem(item.id, {
              name: item.name || 'Pelanggan',
              phone: item.phone || '',
              address: item.address || 'Alamat Penerima',
              cod_amount: item.cod_amount || 'NO COD',
              package_count: item.package_count || '1',
              status: 'completed',
              image_url: ''
            });
          }
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    };

    const workerTop = worker(0, 'top');
    const workerBottom = itemsToProcess.length > 1 ? worker(1, 'bottom') : null;

    await Promise.all([workerTop, workerBottom].filter(Boolean));

    if (isPausedRef.current) {
      if (setBulkItems) {
        setBulkItems(prev => prev.map(item => item.status === 'processing' ? { ...item, status: 'pending' } : item));
      }
      setProcessing(false);
      setIsPaused(true);
    } else {
      setProcessing(false);
      setIsPaused(false);
    }
  };

  const handleQuickFill = () => {
    bulkItems.forEach((item, idx) => {
      if (item.status !== 'completed') {
        handleUpdateBulkItem(item.id, {
          name: item.name || `edgar maulana ${idx + 1}`,
          phone: item.phone || `085878250181`,
          address: item.address || `Jalan Ampel, RT.6/RW.8, Kudorejan, Urutsewu, Ampel, KAB. BOYOLALI`,
          cod_amount: item.cod_amount || '33.500',
          package_count: '1',
          status: 'completed',
          image_url: ''
        });
      }
    });
  };

  const handleCopyAll = () => {
    const text = sortedItems
      .filter(item => item.status === 'completed')
      .map(item => {
        const pkgText = item.package_count ? ` (${item.package_count} Paket)` : '';
        return `${item.order}. ${item.name || '[NO NAME]'}${pkgText}\n${item.phone || '[NO PHONE]'}\n${item.address || '[NO ADDRESS]'}\nCOD: ${item.cod_amount}\n---`;
      })
      .join('\n');
    
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const completedCount = bulkItems.filter(i => i.status === 'completed').length;
  const pendingCount = bulkItems.length - completedCount;

  return (
    <div 
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "flex flex-col h-full py-2 px-1 relative transition-colors",
        isDragging && "bg-[#C5A059]/5 border-2 border-dashed border-[#C5A059] rounded-2xl"
      )}
    >
      {/* Header */}
      <div className="flex justify-between items-center mb-3 bg-[#18181B] border border-[#232328] rounded-2xl p-3.5 shadow-sm">
        <div>
          <h1 className="text-sm font-extrabold tracking-wider text-[#C5A059] uppercase">FILLING / BULK PROCESSOR</h1>
          <p className="text-[11px] text-neutral-400 font-medium">
            {draggingId
              ? 'Geser kartu ke atas / bawah untuk atur posisi'
              : bulkItems.length > 1
                ? `${bulkItems.length} label dalam antrean • Tekan lama kartu untuk geser`
                : `${bulkItems.length} label dalam antrean`}
          </p>
        </div>
        <div className="flex gap-2">
          {bulkItems.length > 0 && (
            <>
              {completedCount > 0 && (
                <button 
                  onClick={handleCopyAll}
                  className={cn(
                    "px-3 py-1.5 bg-neutral-800 text-white border border-neutral-700 rounded-xl active:scale-95 transition-all flex items-center gap-1.5 font-bold text-[11px] shadow-sm cursor-pointer",
                    copied && "bg-emerald-600 text-white border-emerald-500"
                  )}
                  title="Salin semua data hasil ekstrak"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "COPIED" : "COPY ALL"}
                </button>
              )}
              <button 
                onClick={handleSendAllToSending}
                disabled={isSending || completedCount === 0}
                className="px-3 py-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 rounded-xl active:scale-95 transition-all flex items-center gap-1.5 font-bold text-[11px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                title="Kirim data yang sudah selesai generate ke modul Sending"
              >
                <Send size={14} className={isSending ? "animate-pulse" : ""} />
                {isSending
                  ? "SENDING..."
                  : pendingCount > 0 && completedCount > 0
                    ? `SEND (${completedCount})`
                    : "SEND"}
              </button>
            </>
          )}
          <button 
            onClick={handleClearAllFilling}
            disabled={bulkItems.length === 0 || isSending}
            className="p-2 bg-red-950/50 text-red-400 border border-red-900/60 hover:bg-red-900/60 rounded-xl active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            title="Hapus seluruh file di modul Filling"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {sendNotice && (
        <div className="mb-3 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold flex items-center justify-between gap-2">
          <span>{sendNotice}</span>
          <button
            type="button"
            onClick={() => setSendNotice(null)}
            className="p-0.5 rounded hover:bg-white/10 text-emerald-300/80 hover:text-white cursor-pointer shrink-0"
            title="Tutup notifikasi"
          >
            <CloseIcon size={13} />
          </button>
        </div>
      )}

      {/* Grid / List of items */}
      <div
        ref={listContainerRef}
        onScroll={() => {
          if (!draggingIdRef.current && longPressMetaRef.current) {
            clearLongPressTimer();
            longPressMetaRef.current = null;
          }
        }}
        className={cn(
          "flex-1 overflow-y-auto space-y-3 px-0.5 pb-4 scrollbar-none relative",
          draggingId && "select-none"
        )}
      >
        {sortedItems.length === 0 ? (
          <label
            htmlFor="filling-file-input"
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "h-64 flex flex-col items-center justify-center text-neutral-500 space-y-3 bg-[#18181B]/50 border border-dashed border-neutral-800 rounded-2xl p-6 text-center cursor-pointer hover:border-[#C5A059]/50 transition-all select-none",
              isDragging && "border-[#C5A059] bg-[#C5A059]/10"
            )}
          >
            <div className="w-12 h-12 bg-neutral-900 rounded-2xl border border-neutral-800 flex items-center justify-center text-[#C5A059]">
              <Plus size={24} />
            </div>
            <p className="font-semibold text-xs text-neutral-300">Belum ada foto label paket</p>
            <p className="text-[11px] text-neutral-400 max-w-xs">
              Klik / sentuh di sini atau tombol &quot;Add Image&quot; untuk mengunggah foto resi (bisa Drag &amp; Drop / Paste).
            </p>
          </label>
        ) : (
          <AnimatePresence mode="popLayout">
            {sortedItems.map((item) => {
              const customExit = exitVectors[item.id] || { x: 140, y: 0, rotate: 0 };
              const isDraggedCard = draggingId === item.id;
              return (
                <motion.div 
                  key={item.id}
                  ref={(el) => {
                    if (el) {
                      cardRefs.current.set(item.id, el);
                    } else {
                      cardRefs.current.delete(item.id);
                    }
                  }}
                  layout={isDraggedCard ? false : 'position'}
                  initial={{ opacity: 0, x: -20, scale: 0.95 }}
                  animate={{
                    opacity: 1,
                    x: 0,
                    y: isDraggedCard ? dragOffsetY : 0,
                    rotate: 0,
                    scale: isDraggedCard ? 1.02 : 1
                  }}
                  transition={isDraggedCard ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 34 }}
                  exit={{ 
                    opacity: 0, 
                    x: customExit.x, 
                    y: customExit.y, 
                    rotate: customExit.rotate, 
                    scale: 0.7, 
                    transition: { duration: 0.28, ease: "easeInOut" } 
                  }}
                  onPointerDown={(e) => handleCardPointerDown(e, item.id)}
                  onContextMenu={(e) => {
                    if (draggingIdRef.current || longPressMetaRef.current?.itemId === item.id) {
                      e.preventDefault();
                    }
                  }}
                  className={cn(
                    "bg-[#18181B] p-3 rounded-2xl border border-[#232328] shadow-sm flex gap-3 items-start transition-colors",
                    isDraggedCard
                      ? "relative z-30 border-[#C5A059] ring-2 ring-[#C5A059]/40 bg-[#1F1F24] shadow-[0_16px_40px_rgba(0,0,0,0.75)] touch-none cursor-grabbing select-none"
                      : draggingId
                        ? "opacity-85 touch-none select-none"
                        : "touch-pan-y"
                  )}
                >
                {/* Thumbnail Preview */}
                <div className="w-16 h-20 bg-black rounded-xl overflow-hidden shrink-0 relative flex items-center justify-center border border-neutral-800">
                  {item.image_url && (item.image_url.startsWith('data:image') || item.image_url.startsWith('http')) ? (
                    <img src={item.image_url} alt="label" className="w-full h-full object-cover opacity-60" />
                  ) : (
                    <div className="w-full h-full bg-neutral-900/90 flex items-center justify-center">
                      <Package size={18} className="text-neutral-700" />
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <div className="w-7 h-7 rounded-full border border-[#C5A059] bg-black/90 text-[#C5A059] flex items-center justify-center font-black text-xs shadow-md backdrop-blur-xs">
                      {item.order}
                    </div>
                  </div>
                </div>

                {/* Info Container */}
                <div className="flex-1 min-w-0 space-y-1">
                  {item.status === 'completed' ? (
                    editingId === item.id ? (
                      <div className="space-y-1.5 bg-neutral-950 p-2 rounded-xl border border-neutral-800">
                        <input 
                          value={editData.name}
                          onChange={e => setEditData({ ...editData, name: e.target.value })}
                          className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1 text-xs font-bold text-white outline-none focus:border-[#C5A059]"
                          placeholder="Nama"
                        />
                        <input 
                          value={editData.phone}
                          onChange={e => setEditData({ ...editData, phone: e.target.value })}
                          className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1 text-[11px] text-white outline-none focus:border-[#C5A059]"
                          placeholder="WhatsApp"
                        />
                        <textarea 
                          value={editData.address}
                          onChange={e => setEditData({ ...editData, address: e.target.value })}
                          className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1 text-xs text-white resize-none outline-none focus:border-[#C5A059]"
                          rows={2}
                          placeholder="Alamat"
                        />
                        <div className="flex gap-1.5">
                          <input 
                            value={editData.cod_amount}
                            onChange={e => setEditData({ ...editData, cod_amount: e.target.value })}
                            className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1 text-xs font-bold text-emerald-400 outline-none focus:border-emerald-500"
                            placeholder="COD Amount"
                          />
                          <input 
                            type="number"
                            min="1"
                            value={editData.package_count}
                            onChange={e => setEditData({ ...editData, package_count: e.target.value })}
                            className="w-16 bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1 text-xs font-bold text-amber-300 outline-none focus:border-amber-400"
                            placeholder="Jml Pkt"
                          />
                          <button onClick={saveEdit} className="p-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg cursor-pointer"><Save size={14} /></button>
                          <button onClick={() => setEditingId(null)} className="p-1.5 bg-neutral-800 text-neutral-400 rounded-lg cursor-pointer"><CloseIcon size={14} /></button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-1.5 max-w-[70%]">
                            <h3 className="font-bold text-white truncate text-xs">{item.name || "[TANPA NAMA]"}</h3>
                            {item.package_count && Number(item.package_count) > 1 && (
                              <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.2 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-md font-extrabold text-[9px]">
                                <Package size={10} /> {item.package_count} Pkt
                              </span>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-emerald-400 font-bold text-[11px]">
                              {item.cod_amount === 'NO COD' ? 'NO COD' : `Rp ${item.cod_amount}`}
                            </span>
                            <div className="flex items-center gap-1">
                              {item.image_url && item.image_url.startsWith('data:image') && (
                                <button 
                                  onClick={() => handleRegenerateSingleItem(item)}
                                  disabled={regeneratingIds.has(item.id)}
                                  className="text-neutral-500 hover:text-amber-400 disabled:opacity-50 transition-colors p-1 cursor-pointer"
                                  title="Generate ulang data resi ini 1 per 1"
                                >
                                  {regeneratingIds.has(item.id) ? (
                                    <Loader2 size={12} className="animate-spin text-amber-400" />
                                  ) : (
                                    <RotateCcw size={12} />
                                  )}
                                </button>
                              )}
                              <button 
                                onClick={() => startEditing(item)}
                                className="text-neutral-500 hover:text-amber-300 transition-colors p-1 cursor-pointer"
                                title="Edit item ini"
                              >
                                <Pencil size={12} />
                              </button>
                            </div>
                          </div>
                        </div>
                        <p className="text-[10px] text-amber-400 font-mono truncate">{item.phone || '-'}</p>
                        <p className="text-[11px] font-medium text-neutral-300 leading-tight line-clamp-2">{item.address || '-'}</p>
                        <div className="pt-1 flex items-center gap-2">
                          <span className="text-[10px] font-bold text-neutral-400 flex items-center gap-1">
                            <Package size={11} /> Jml Paket:
                          </span>
                          <input 
                            type="number"
                            min="1"
                            placeholder="1"
                            value={item.package_count || ''}
                            onChange={(e) => handleUpdateBulkItem(item.id, { package_count: e.target.value })}
                            className="w-14 h-5 px-1.5 py-0 bg-black border border-neutral-800 rounded text-[10px] font-bold text-amber-300 focus:outline-none focus:border-[#C5A059]"
                          />
                        </div>
                      </>
                    )
                  ) : (
                    <div className="h-full flex items-center justify-between py-2">
                       <div className="flex flex-col justify-center gap-1.5 flex-1 min-w-0 pr-2">
                        <div className="flex items-center gap-2">
                          {(item.status === 'processing' || regeneratingIds.has(item.id)) && (
                            <Loader2 size={12} className="animate-spin text-amber-400 shrink-0" />
                          )}
                          <span className={cn(
                            "text-[10px] font-bold uppercase tracking-wider truncate",
                            item.status === 'pending' ? (isPaused ? "text-amber-500" : "text-neutral-500") : "text-amber-400"
                          )}>
                            {regeneratingIds.has(item.id) 
                              ? 'Ekstrak Ulang Resi...' 
                              : item.status === 'pending' 
                                ? (isPaused ? 'Dihentikan / Dijeda' : 'Siap Diproses') 
                                : item.status === 'processing' 
                                  ? 'Mengekstrak Label...' 
                                  : 'Terjadi Kesalahan'}
                          </span>
                        </div>
                        <div className="h-1.5 bg-neutral-900 rounded-full w-full overflow-hidden border border-neutral-800">
                          {(item.status === 'processing' || regeneratingIds.has(item.id)) && (
                            <motion.div 
                              className="h-full bg-amber-400" 
                              animate={{ x: ['-100%', '100%'] }} 
                              transition={{ duration: 1, repeat: Infinity }} 
                            />
                          )}
                        </div>
                       </div>

                       <button
                         onClick={() => handleRegenerateSingleItem(item)}
                         disabled={regeneratingIds.has(item.id) || item.status === 'processing'}
                         className="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/40 text-amber-300 rounded-lg flex items-center gap-1 text-[10px] font-bold transition-all disabled:opacity-40 cursor-pointer shrink-0"
                         title="Generate manual 1 per 1 untuk resi ini"
                       >
                         {regeneratingIds.has(item.id) ? (
                           <Loader2 size={11} className="animate-spin text-amber-300" />
                         ) : (
                           <RotateCcw size={11} />
                         )}
                         <span>Regenerate</span>
                       </button>
                    </div>
                  )}
                </div>

                {/* Reorder and Handle */}
                <div className="flex flex-col justify-between items-end gap-2 shrink-0">
                  <input 
                    type="number"
                    value={item.is_reordered ? item.order : ''}
                    placeholder="—"
                    onChange={(e) => handleReorderBulkItem(item.id, parseInt(e.target.value) || item.order)}
                    className="w-7 h-7 bg-black border border-neutral-800 rounded-lg text-center text-xs font-bold text-[#C5A059] focus:border-[#C5A059] appearance-none"
                    title="Nomor urut"
                  />
                  <div
                    data-drag-handle="true"
                    className={cn(
                      "p-1 rounded-lg transition-colors cursor-grab active:cursor-grabbing touch-none",
                      isDraggedCard ? "text-[#C5A059] bg-[#C5A059]/15" : "text-neutral-500 hover:text-neutral-300"
                    )}
                    title="Tekan & geser atas/bawah untuk memindah posisi kartu"
                  >
                    <GripVertical size={16} />
                  </div>
                </div>
              </motion.div>
            );
          })}
          </AnimatePresence>
        )}
      </div>

      {/* Action Footer */}
      <div className="pt-2 pb-1 flex gap-2 shrink-0">
        <label 
          htmlFor="filling-file-input"
          onClick={() => {
            if (fileInputRef.current) {
              fileInputRef.current.click();
            }
          }}
          className="px-3 h-12 bg-neutral-900 border border-neutral-700 hover:border-[#C5A059] text-white rounded-xl flex items-center justify-center gap-1.5 font-bold shadow-sm active:scale-95 transition-all text-xs cursor-pointer shrink-0 select-none"
          title="Tambah foto resi/label baru"
        >
          <Plus size={16} className="text-[#C5A059]" />
          Add Image
        </label>

        {bulkItems.some(i => i.status !== 'completed') && (
          <button
            onClick={handleQuickFill}
            className="px-3 h-12 bg-neutral-800 border border-neutral-700 hover:border-amber-500/50 text-amber-300 rounded-xl flex items-center justify-center gap-1 font-bold shadow-sm active:scale-95 transition-all text-[11px] cursor-pointer shrink-0"
            title="Isi otomatis cepat tanpa menunggu AI"
          >
            Quick Fill
          </button>
        )}

        {processing ? (
          <>
            <button
              onClick={handleStop}
              className="px-4 h-12 bg-red-600 hover:bg-red-500 text-white border border-red-400 rounded-xl flex items-center justify-center gap-1.5 font-extrabold shadow-lg active:scale-95 transition-all text-xs cursor-pointer shrink-0"
              title="Hentikan Proses Pemrosesan Ekstrak"
            >
              <Square size={16} fill="currentColor" />
              STOP
            </button>

            <button 
              disabled
              className="flex-1 h-12 bg-neutral-800/80 text-amber-300 border border-neutral-700 rounded-xl flex items-center justify-center gap-2 font-bold text-xs shrink-0 cursor-wait"
            >
              <Loader2 size={18} className="animate-spin text-amber-400" />
              Proses AI...
            </button>
          </>
        ) : (
          <button 
            onClick={handleProcess}
            disabled={bulkItems.length === 0 || bulkItems.every(i => i.status === 'completed')}
            className="flex-1 h-12 bg-[#C5A059] hover:bg-[#D4AF37] text-black rounded-xl flex items-center justify-center gap-2 font-extrabold shadow-lg active:scale-95 transition-all disabled:opacity-40 text-xs cursor-pointer"
            title="Mulai / Lanjutkan ekstrak AI untuk semua resi yang belum selesai"
          >
            <Play size={18} fill="currentColor" />
            {isPaused ? "Lanjutkan Generate (Play)" : "Generate Resi (Play)"}
          </button>
        )}
      </div>

      <input 
        id="filling-file-input"
        type="file" 
        multiple 
        accept="image/*" 
        className="opacity-0 absolute pointer-events-none w-0 h-0 overflow-hidden" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
      />
    </div>
  );
};

