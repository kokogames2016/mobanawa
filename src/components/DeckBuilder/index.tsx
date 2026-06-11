import { useState, useMemo, useRef, useEffect } from 'react';
import { useStore, isSampleDeck } from '../../store';
import type { Card, Deck, DeckFolder, Rarity } from '../../types';
import { CardShape } from '../common/CardShape';
import { useIsLandscape } from '../../hooks/useIsLandscape';

type SortKey = 'id' | 'size' | 'rarity' | 'name';

function generateId(): string {
  try { return crypto.randomUUID(); } catch {}
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

const RARITY_ORDER: Record<Rarity, number> = { fresh: 0, rare: 1, common: 2 };

const SIZE_GROUPS = [
  { label: '1-3', min: 1, max: 3 },
  { label: '4-5', min: 4, max: 5 },
  { label: '6-8', min: 6, max: 8 },
  { label: '9-11', min: 9, max: 11 },
  { label: '12-15', min: 12, max: 15 },
  { label: '16+', min: 16, max: Infinity },
];

const tap: React.CSSProperties = {
  touchAction: 'manipulation',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};

const MY_DECK_SECTION_KEY     = 'nawabattler_mydecksection_open';
const SAMPLE_DECK_SECTION_KEY = 'nawabattler_sampledecksection_open';

// Snapshot type for undo/redo (main + reserve)
type SlotSnap = { main: string[]; reserve: string[] };

export function DeckBuilder() {
  const {
    cards, decks, currentDeck, saveDeck, deleteDeck, setCurrentDeck, newDeck,
    folders, saveFolder, deleteFolder, moveDeckToFolder, reorderRootDecks, toggleFolderOpen,
  } = useStore();
  const isLandscape = useIsLandscape();

  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortAsc, setSortAsc] = useState(true);
  const [cardCellSize, setCardCellSize] = useState(3);
  const [deckName, setDeckName] = useState('新しいデッキ');
  const [saveFlash, setSaveFlash] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ── マイデッキセクション折りたたみ ───────────────────────────────────────────
  const [myDeckSectionOpen, setMyDeckSectionOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(MY_DECK_SECTION_KEY);
      return v === null ? true : v === 'true';
    } catch { return true; }
  });

  function toggleMyDeckSection() {
    const next = !myDeckSectionOpen;
    setMyDeckSectionOpen(next);
    try { localStorage.setItem(MY_DECK_SECTION_KEY, String(next)); } catch {}
  }

  // ── サンプルデッキセクション折りたたみ ────────────────────────────────────────
  const [sampleDeckSectionOpen, setSampleDeckSectionOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(SAMPLE_DECK_SECTION_KEY);
      return v === 'true'; // デフォルト: 閉じた状態
    } catch { return false; }
  });

  function toggleSampleDeckSection() {
    const next = !sampleDeckSectionOpen;
    setSampleDeckSectionOpen(next);
    try { localStorage.setItem(SAMPLE_DECK_SECTION_KEY, String(next)); } catch {}
  }

  // ── Undo / Redo ───────────────────────────────────────────────────────────────
  const [undoStack, setUndoStack] = useState<SlotSnap[]>([]);
  const [redoStack, setRedoStack] = useState<SlotSnap[]>([]);
  // Track deck identity to reset history when a different deck is loaded
  const prevDeckIdRef = useRef<string>('');

  // ── Folder UI state ───────────────────────────────────────────────────────────
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [editFolderId, setEditFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);
  // ── Deck drag state (HTML5 for desktop) ───────────────────────────────────────
  const [draggingDeckId, setDraggingDeckId] = useState<string | null>(null);
  const [dragOverZone, setDragOverZone] = useState<string | null>(null); // 'root' | folderId
  // Insert-position tracking within a zone
  const [dragOverDeckId, setDragOverDeckId] = useState<string | null>(null);
  const [dragInsertAfter, setDragInsertAfter] = useState(false);

  // ── Card-slot drag state ──────────────────────────────────────────────────────
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // ── Export / Import state ─────────────────────────────────────────────────────
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportDeckId, setExportDeckId] = useState('');
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Touch long-press for card-slot drag
  const slotContainerRef = useRef<HTMLDivElement>(null);
  const touchLongPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchDragFromRef = useRef<number | null>(null);
  const touchDraggingRef = useRef(false); // true once long-press fires

  // Prevent-default touchmove on slot container when dragging (avoid passive listener issue)
  useEffect(() => {
    const el = slotContainerRef.current;
    if (!el) return;
    const handler = (e: TouchEvent) => {
      if (touchDraggingRef.current) e.preventDefault();
    };
    el.addEventListener('touchmove', handler, { passive: false });
    return () => el.removeEventListener('touchmove', handler);
  }, []);

  // ── Touch long-press drag for deck chips ──────────────────────────────────────
  const deckTouchLongPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deckTouchDraggingRef = useRef<string | null>(null); // deckId being dragged

  const editDeck = currentDeck ?? { id: '', name: deckName, cardIds: [], reserveCardIds: [], createdAt: 0, updatedAt: 0 };
  const isPreset = isSampleDeck(editDeck.id);
  const userDecks   = decks.filter(d => d.id !== 'all' && !isSampleDeck(d.id));
  const sampleDecks = decks.filter(d => isSampleDeck(d.id));

  // Slot arrays
  const mainIds    = editDeck.cardIds;
  const reserveIds = editDeck.reserveCardIds ?? [];
  const totalCards = mainIds.length + reserveIds.length;

  // Reset undo/redo when a different deck is loaded
  useEffect(() => {
    const currentId = editDeck.id;
    if (currentId !== prevDeckIdRef.current) {
      prevDeckIdRef.current = currentId;
      setUndoStack([]);
      setRedoStack([]);
    }
  }, [editDeck.id]);

  // Folder → deck mapping
  const deckFolderMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of folders) {
      for (const id of f.deckIds) map.set(id, f.id);
    }
    return map;
  }, [folders]);

  const rootUserDecks = userDecks.filter(d => !deckFolderMap.has(d.id));

  const sortedCards = useMemo(() => {
    const result = [...cards];
    result.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'id') cmp = Number(a.id) - Number(b.id);
      else if (sortKey === 'size') { cmp = a.size - b.size; if (cmp === 0) cmp = a.name.localeCompare(b.name, 'ja'); }
      else if (sortKey === 'rarity') cmp = (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9);
      else if (sortKey === 'name') cmp = a.name.localeCompare(b.name, 'ja');
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [cards, sortKey, sortAsc]);

  const mainCards    = mainIds.map(id => cards.find(c => c.id === id)).filter(Boolean) as Card[];
  const reserveCards = reserveIds.map(id => cards.find(c => c.id === id)).filter(Boolean) as Card[];
  const allDeckCards = [...mainCards, ...reserveCards];
  const totalSize  = allDeckCards.reduce((s, c) => s + c.size, 0);
  const swCount    = allDeckCards.filter(c => !c.hasSpecialSquare).length;
  const sizeGroups = SIZE_GROUPS.map(g => ({
    label: g.label,
    count: allDeckCards.filter(c => c.size >= g.min && c.size <= g.max).length,
  }));
  const incomplete = mainIds.length < 15;

  // ── Slot operations (with undo history) ──────────────────────────────────────
  function applySlots(newMain: string[], newReserve: string[], skipHistory = false) {
    if (!skipHistory) {
      setUndoStack(s => [...s.slice(-19), { main: mainIds, reserve: reserveIds }]);
      setRedoStack([]);
    }
    setCurrentDeck({ ...editDeck, cardIds: newMain, reserveCardIds: newReserve, name: deckName, updatedAt: Date.now() });
  }

  function addCard(card: Card) {
    if (mainIds.includes(card.id) || reserveIds.includes(card.id)) return;
    if (totalCards >= 21) return;
    if (mainIds.length < 15) {
      applySlots([...mainIds, card.id], reserveIds);
    } else {
      applySlots(mainIds, [...reserveIds, card.id]);
    }
  }

  function removeCard(id: string) {
    if (mainIds.includes(id)) {
      applySlots(mainIds.filter(x => x !== id), reserveIds);
    } else {
      applySlots(mainIds, reserveIds.filter(x => x !== id));
    }
  }

  // Unified slot index: 0-14 = main, 15-17 = reserve
  function swapSlots(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    // Build a padded 21-element array (null = empty)
    const all: (string | null)[] = new Array(21).fill(null);
    mainIds.forEach((id, i) => { all[i] = id; });
    reserveIds.forEach((id, i) => { all[15 + i] = id; });
    if (!all[fromIdx] || !all[toIdx]) return; // only swap filled slots
    [all[fromIdx], all[toIdx]] = [all[toIdx], all[fromIdx]];
    const newMain    = all.slice(0, 15).filter((x): x is string => x !== null);
    const newReserve = all.slice(15, 21).filter((x): x is string => x !== null);
    applySlots(newMain, newReserve);
  }

  function resetDeck() {
    setUndoStack([]);
    setRedoStack([]);
    setCurrentDeck({ ...editDeck, cardIds: [], reserveCardIds: [], updatedAt: Date.now() });
  }

  function handleUndo() {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(s => [{ main: mainIds, reserve: reserveIds }, ...s]);
    setUndoStack(s => s.slice(0, -1));
    setCurrentDeck({ ...editDeck, cardIds: prev.main, reserveCardIds: prev.reserve, updatedAt: Date.now() });
  }

  function handleRedo() {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setUndoStack(s => [...s, { main: mainIds, reserve: reserveIds }]);
    setRedoStack(s => s.slice(1));
    setCurrentDeck({ ...editDeck, cardIds: next.main, reserveCardIds: next.reserve, updatedAt: Date.now() });
  }

  function handleSave() {
    const deck: Deck = {
      ...editDeck,
      id: isPreset ? generateId() : (editDeck.id || generateId()),
      name: deckName,
      createdAt: isPreset ? Date.now() : (editDeck.createdAt || Date.now()),
      updatedAt: Date.now(),
    };
    saveDeck(deck);
    setUndoStack([]);
    setRedoStack([]);
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 1200);
  }

  function handleLoadDeck(deck: Deck) {
    setCurrentDeck(deck);
    setDeckName(deck.name);
    // history reset handled by useEffect watching editDeck.id
  }

  function handleCopyDeck(deck: Deck) {
    const copyName = `${deck.name}のコピー`;
    const copy: Deck = { ...deck, id: generateId(), name: copyName, createdAt: Date.now(), updatedAt: Date.now() };
    saveDeck(copy);
    setDeckName(copyName);
  }

  // ── Folder operations ─────────────────────────────────────────────────────────
  function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    const folder: DeckFolder = { id: generateId(), name: newFolderName.trim(), deckIds: [], open: true, createdAt: Date.now() };
    saveFolder(folder);
    setNewFolderName('');
    setShowNewFolder(false);
  }

  function handleRenameFolder(id: string) {
    if (!editFolderName.trim()) return;
    const f = folders.find(f => f.id === id);
    if (!f) return;
    saveFolder({ ...f, name: editFolderName.trim() });
    setEditFolderId(null);
  }

  function handleDeleteFolder(id: string) {
    deleteFolder(id);
    setConfirmDeleteFolderId(null);
  }

  // ── Deck chip drag handlers ───────────────────────────────────────────────────
  function resetDeckDragState() {
    setDraggingDeckId(null);
    deckTouchDraggingRef.current = null;
    setDragOverZone(null);
    setDragOverDeckId(null);
  }

  function handleDeckDrop(targetZone: string | null) {
    const id = draggingDeckId ?? deckTouchDraggingRef.current;
    if (!id) return;
    moveDeckToFolder(id, targetZone === 'root' ? null : targetZone);
    resetDeckDragState();
  }

  function dropZoneProps(zone: string) {
    const isOver = dragOverZone === zone && !!draggingDeckId;
    return {
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverZone(zone); },
      onDragLeave: () => { setDragOverZone(null); setDragOverDeckId(null); },
      onDrop: (e: React.DragEvent) => { e.preventDefault(); handleDeckDrop(zone === 'root' ? null : zone); },
      className: isOver ? 'ring-1 ring-inset ring-orange-400 rounded' : '',
    };
  }

  // ── Deck touch drag (long-press 500ms → slide → release to drop) ─────────────
  function deckChipTouchStart(deckId: string) {
    deckTouchLongPressRef.current = setTimeout(() => {
      deckTouchDraggingRef.current = deckId;
      setDraggingDeckId(deckId); // show visual feedback (opacity-40)
    }, 500);
  }

  function deckChipTouchMove(e: React.TouchEvent) {
    if (!deckTouchDraggingRef.current) {
      // Before long-press fires: cancel if finger moved
      if (deckTouchLongPressRef.current) { clearTimeout(deckTouchLongPressRef.current); deckTouchLongPressRef.current = null; }
      return;
    }
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    // Zone detection (folder or root)
    const zoneEl = el?.closest('[data-drop-zone]') as HTMLElement | null;
    setDragOverZone(zoneEl?.dataset.dropZone ?? null);
    // Chip-level detection for insert-before/after position
    const chipEl = el?.closest('[data-deck-chip-id]') as HTMLElement | null;
    if (chipEl && chipEl.dataset.deckChipId !== deckTouchDraggingRef.current) {
      const rect = chipEl.getBoundingClientRect();
      setDragOverDeckId(chipEl.dataset.deckChipId ?? null);
      setDragInsertAfter(touch.clientX > rect.left + rect.width / 2);
    } else {
      setDragOverDeckId(null);
    }
  }

  function deckChipTouchEnd() {
    if (deckTouchLongPressRef.current) { clearTimeout(deckTouchLongPressRef.current); deckTouchLongPressRef.current = null; }
    const draggedId = deckTouchDraggingRef.current;
    if (draggedId && dragOverZone) {
      if (dragOverDeckId && draggedId !== dragOverDeckId) {
        // Insert at position relative to the hovered chip
        let zoneDecks: Deck[];
        if (dragOverZone === 'root') {
          zoneDecks = rootUserDecks;
        } else {
          const f = folders.find(f => f.id === dragOverZone);
          zoneDecks = f ? f.deckIds.map(id => userDecks.find(d => d.id === id)).filter(Boolean) as Deck[] : [];
        }
        const chipIdx = zoneDecks.findIndex(d => d.id === dragOverDeckId);
        const nextDeck = chipIdx >= 0 && chipIdx < zoneDecks.length - 1 ? zoneDecks[chipIdx + 1] : null;
        const insertBeforeId = dragInsertAfter ? (nextDeck?.id ?? null) : dragOverDeckId;
        if (dragOverZone === 'root') {
          const fromFolder = deckFolderMap.get(draggedId);
          if (fromFolder) moveDeckToFolder(draggedId, null);
          reorderRootDecks(draggedId, insertBeforeId);
        } else {
          moveDeckToFolder(draggedId, dragOverZone, insertBeforeId);
        }
      } else {
        // Dropped on zone without targeting a specific chip → append to zone
        if (dragOverZone === 'root') {
          const fromFolder = deckFolderMap.get(draggedId);
          if (fromFolder) moveDeckToFolder(draggedId, null);
          reorderRootDecks(draggedId, null);
        } else {
          moveDeckToFolder(draggedId, dragOverZone);
        }
      }
    }
    deckTouchDraggingRef.current = null;
    setDraggingDeckId(null);
    setDragOverZone(null);
    setDragOverDeckId(null);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  // ── Export / Import handlers ──────────────────────────────────────────────────
  function handleExport() {
    const deck = userDecks.find(d => d.id === exportDeckId);
    if (!deck) return;
    const data = {
      name: deck.name,
      cardIds: deck.cardIds,
      reserveCardIds: deck.reserveCardIds ?? [],
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deck.name}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportSuccess(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (!Array.isArray(data.cardIds)) throw new Error('cardIds missing');
        let name = typeof data.name === 'string' && data.name.trim()
          ? data.name.trim() : 'インポートデッキ';
        const existingNames = userDecks.map(d => d.name);
        if (existingNames.includes(name)) {
          let n = 2;
          while (existingNames.includes(`${name}(${n})`)) n++;
          name = `${name}(${n})`;
        }
        const imported: Deck = {
          id: generateId(),
          name,
          cardIds: (data.cardIds as unknown[])
            .filter((id): id is string => typeof id === 'string' && cards.some(c => c.id === id)),
          reserveCardIds: Array.isArray(data.reserveCardIds)
            ? (data.reserveCardIds as unknown[])
                .filter((id): id is string => typeof id === 'string' && cards.some(c => c.id === id))
            : [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        saveDeck(imported);
        setImportSuccess(`「${name}」をマイデッキに追加しました`);
      } catch {
        setImportError('ファイルの読み込みに失敗しました。正しいデッキファイルを選択してください。');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  const folderLabel = isPreset
    ? { text: 'サンプル', cls: 'bg-gray-700 text-gray-300' }
    : editDeck.id
      ? { text: 'マイデッキ', cls: 'bg-orange-900 text-orange-300' }
      : null;

  // ── Deck chip renderer ────────────────────────────────────────────────────────
  function renderDeckChip(deck: Deck, zone: string, zoneDecks: Deck[], chipIdx: number): React.ReactNode {
    const isDragging = draggingDeckId === deck.id;
    const isInsertTarget = dragOverDeckId === deck.id && !!draggingDeckId && draggingDeckId !== deck.id;
    const nextDeck = chipIdx < zoneDecks.length - 1 ? zoneDecks[chipIdx + 1] : null;
    const rCount = deck.reserveCardIds?.length ?? 0;

    if (confirmDeleteId === deck.id) {
      return (
        <div key={deck.id} className="flex items-stretch flex-shrink-0">
          <span className="text-xs px-2 py-1 bg-red-950 border border-red-700 rounded-l text-red-300 leading-tight whitespace-nowrap">
            「{deck.name}」を削除?
          </span>
          <button type="button" style={tap}
            onClick={() => { deleteDeck(deck.id); setConfirmDeleteId(null); }}
            className="text-xs px-2 py-1 bg-red-700 active:bg-red-600 text-white border border-l-0 border-red-600 leading-tight select-none">削除</button>
          <button type="button" style={tap} onClick={() => setConfirmDeleteId(null)}
            className="text-xs px-2 py-1 bg-gray-700 active:bg-gray-600 text-gray-300 border border-l-0 border-gray-600 rounded-r leading-tight select-none">取消</button>
        </div>
      );
    }

    return (
      <div
        key={deck.id}
        data-deck-chip-id={deck.id}
        draggable={true}
        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', deck.id); setDraggingDeckId(deck.id); }}
        onDragEnd={() => resetDeckDragState()}
        onDragOver={e => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setDragOverDeckId(deck.id);
          setDragInsertAfter(e.clientX > rect.left + rect.width / 2);
          setDragOverZone(zone);
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOverDeckId(prev => prev === deck.id ? null : prev);
          }
        }}
        onDrop={e => {
          e.preventDefault();
          e.stopPropagation();
          const draggedId = draggingDeckId;
          if (!draggedId || draggedId === deck.id) { resetDeckDragState(); return; }
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const isAfter = e.clientX > rect.left + rect.width / 2;
          const insertBeforeId = isAfter ? (nextDeck?.id ?? null) : deck.id;
          if (zone === 'root') {
            const fromFolder = deckFolderMap.get(draggedId);
            if (fromFolder) moveDeckToFolder(draggedId, null);
            reorderRootDecks(draggedId, insertBeforeId);
          } else {
            moveDeckToFolder(draggedId, zone, insertBeforeId);
          }
          resetDeckDragState();
        }}
        onTouchStart={() => deckChipTouchStart(deck.id)}
        onTouchMove={deckChipTouchMove}
        onTouchEnd={deckChipTouchEnd}
        className={`relative flex items-stretch flex-shrink-0 transition-opacity ${isDragging ? 'opacity-40 cursor-grabbing' : 'cursor-grab'}`}
      >
        {/* Insert-position indicator lines */}
        {isInsertTarget && !dragInsertAfter && (
          <div className="absolute inset-y-0 left-0 w-0.5 bg-orange-400 z-10 rounded pointer-events-none" style={{ left: -1 }} />
        )}
        {isInsertTarget && dragInsertAfter && (
          <div className="absolute inset-y-0 right-0 w-0.5 bg-orange-400 z-10 rounded pointer-events-none" style={{ right: -1 }} />
        )}
        <button type="button" style={tap} onClick={() => !isDragging && handleLoadDeck(deck)}
          className={`text-xs px-2 py-1 rounded-l border leading-tight select-none ${
            currentDeck?.id === deck.id
              ? 'bg-orange-900 border-orange-500 text-orange-300'
              : 'bg-gray-800 active:bg-gray-600 border-gray-600 text-gray-300'
          }`}>
          {deck.name}
          <span className="text-gray-500 ml-1">({deck.cardIds.length}{rCount > 0 ? `+${rCount}` : ''})</span>
        </button>
        <button type="button" style={tap} onClick={() => !isDragging && handleCopyDeck(deck)} title="コピー"
          className="text-xs px-1.5 py-1 bg-gray-800 active:bg-gray-600 text-gray-400 border border-l-0 border-gray-600 leading-tight select-none">⧉</button>
        <button type="button" style={tap} onClick={() => !isDragging && setConfirmDeleteId(deck.id)}
          className="text-xs px-1.5 py-1 bg-gray-800 active:bg-red-900 rounded-r text-red-500 border border-l-0 border-gray-600 leading-tight select-none">×</button>
      </div>
    );
  }

  // ── Slot renderer (shared for main 0-14 and reserve 15-20) ───────────────────
  // compact=true: reserve slots — smaller shape, no text, fits 6 per row
  function renderDeckSlot(slotIdx: number, card: Card | undefined, emptyLabel: React.ReactNode, compact = false) {
    const isDragSrc  = dragFromIdx === slotIdx;
    const isDragOver = dragOverIdx === slotIdx && dragFromIdx !== null && dragOverIdx !== dragFromIdx;

    function onTouchStart() {
      if (!card) return;
      touchLongPressRef.current = setTimeout(() => {
        touchDraggingRef.current = true;
        touchDragFromRef.current = slotIdx;
        setDragFromIdx(slotIdx);
      }, 350);
    }
    function onTouchMoveSlot(e: React.TouchEvent) {
      if (!touchDraggingRef.current) {
        if (touchLongPressRef.current) { clearTimeout(touchLongPressRef.current); touchLongPressRef.current = null; }
        return;
      }
      const touch = e.touches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const slotEl = el?.closest('[data-slot-idx]') as HTMLElement | null;
      if (slotEl) {
        const idx = parseInt(slotEl.dataset.slotIdx ?? '-1', 10);
        if (idx >= 0) setDragOverIdx(idx);
      }
    }
    function onTouchEnd() {
      if (touchLongPressRef.current) { clearTimeout(touchLongPressRef.current); touchLongPressRef.current = null; }
      if (touchDraggingRef.current && touchDragFromRef.current !== null && dragOverIdx !== null) {
        swapSlots(touchDragFromRef.current, dragOverIdx);
      }
      touchDraggingRef.current = false;
      touchDragFromRef.current = null;
      setDragFromIdx(null);
      setDragOverIdx(null);
    }

    return (
      <div
        key={slotIdx}
        data-slot-idx={slotIdx}
        draggable={!!card}
        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragFromIdx(slotIdx); setDragOverIdx(slotIdx); }}
        onDragOver={e => { e.preventDefault(); setDragOverIdx(slotIdx); }}
        onDragEnd={() => {
          if (dragFromIdx !== null && dragOverIdx !== null && dragFromIdx !== dragOverIdx) {
            swapSlots(dragFromIdx, dragOverIdx);
          }
          setDragFromIdx(null); setDragOverIdx(null);
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMoveSlot}
        onTouchEnd={onTouchEnd}
        onClick={() => {
          if (card && dragFromIdx === null && !touchDraggingRef.current) removeCard(card.id);
        }}
        title={card
          ? compact
            ? `${card.name}（${card.size}m${card.spp > 0 ? ` SP${card.spp}` : ''}）タップで削除`
            : `${card.name}（タップで削除 / ドラッグで入れ替え）`
          : '空き'}
        style={{ cursor: card ? (isDragSrc ? 'grabbing' : 'grab') : 'default', touchAction: 'none' }}
        className={`rounded border text-left transition-colors select-none ${
          isDragOver
            ? 'border-orange-400 bg-orange-950 ring-1 ring-orange-400'
            : isDragSrc
              ? 'border-gray-500 bg-gray-700 opacity-50'
              : card
                ? 'bg-gray-800 border-gray-600'
                : 'bg-gray-900 border-dashed border-gray-700 opacity-40'
        }`}
      >
        {card ? (
          compact ? (
            /* Reserve compact: shape + name + size/SPP */
            <div className="flex flex-col items-center px-px py-px">
              <CardShape shape={card.shape} specialPos={card.specialPos} cellSize={2} p1Color="#FFE000" spColor="#FF4500" />
              <div className="w-full truncate text-center leading-none" style={{ fontSize: '6px', color: '#ccc', marginTop: 1 }}>{card.name}</div>
              <div className="w-full text-center leading-none" style={{ fontSize: '6px', color: '#777' }}>
                {card.size}m{card.spp > 0 ? ` S${card.spp}` : ''}
              </div>
            </div>
          ) : (
            <div className="p-0.5">
              <CardShape shape={card.shape} specialPos={card.specialPos} cellSize={3} p1Color="#FFE000" spColor="#FF4500" />
              <div className="text-white truncate leading-tight mt-0.5" style={{ fontSize: '8px' }}>{card.name}</div>
              <div className="text-gray-500 leading-tight" style={{ fontSize: '8px' }}>{card.size}m{card.spp > 0 ? ` S${card.spp}` : ''}</div>
            </div>
          )
        ) : (
          compact ? (
            /* Reserve compact empty — height matches filled slots via grid auto-sizing */
            <div className="flex items-center justify-center py-1">
              <span className="text-gray-700" style={{ fontSize: '7px' }}>{emptyLabel}</span>
            </div>
          ) : (
            <div className="p-0.5 h-10 flex items-center justify-center">
              <span className="text-gray-700" style={{ fontSize: '10px' }}>{emptyLabel}</span>
            </div>
          )
        )}
      </div>
    );
  }

  // ── Shared JSX blocks ─────────────────────────────────────────────────────────

  const deckFormBar = (
    <form onSubmit={e => { e.preventDefault(); handleSave(); }}
      className="flex-shrink-0 bg-gray-900 border-b border-gray-700 px-2 py-2 flex items-center gap-1.5">
      {folderLabel && (
        <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 font-bold leading-tight ${folderLabel.cls}`}>
          {folderLabel.text}
        </span>
      )}
      <input type="text" value={deckName} onChange={e => setDeckName(e.target.value)} placeholder="デッキ名"
        className="flex-1 min-w-0 px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-white font-bold" />
      {/* Card count: main / reserve */}
      <span className={`text-xs font-bold shrink-0 tabular-nums text-center ${incomplete ? 'text-yellow-400' : 'text-green-400'}`}>
        {mainIds.length}/15
        {reserveIds.length > 0 && <span className="text-gray-400 text-xs ml-0.5">+{reserveIds.length}</span>}
      </span>
      {/* Undo / Redo */}
      <button type="button" style={tap} onClick={handleUndo} disabled={undoStack.length === 0}
        title="元に戻す (Undo)"
        className="px-2 py-1.5 bg-gray-700 active:bg-gray-500 disabled:opacity-30 text-white rounded text-xs shrink-0 select-none">↩</button>
      <button type="button" style={tap} onClick={handleRedo} disabled={redoStack.length === 0}
        title="やり直し (Redo)"
        className="px-2 py-1.5 bg-gray-700 active:bg-gray-500 disabled:opacity-30 text-white rounded text-xs shrink-0 select-none">↪</button>
      <button type="submit" style={tap}
        className={`px-2 py-1.5 rounded text-xs font-bold shrink-0 transition-colors select-none whitespace-nowrap ${
          saveFlash ? 'bg-green-600 text-white' :
          isPreset ? 'bg-blue-700 active:bg-blue-500 text-white' :
          'bg-orange-600 active:bg-orange-400 text-white'
        }`}>
        {saveFlash ? '✓保存' : isPreset ? 'マイに保存' : '保存'}
      </button>
      <button type="button" style={tap} onClick={() => { newDeck(); setDeckName('新しいデッキ'); setUndoStack([]); setRedoStack([]); }}
        className="px-2 py-1.5 bg-gray-700 active:bg-gray-500 text-white rounded text-xs shrink-0 select-none">新規</button>
      <button type="button" style={tap} onClick={resetDeck} disabled={totalCards === 0}
        className="px-2 py-1.5 bg-gray-800 active:bg-red-900 text-red-400 rounded text-xs shrink-0 select-none disabled:opacity-30">CLR</button>
    </form>
  );

  // マイデッキ一覧（フォルダ対応 + 折りたたみ）
  const myDeckList = (
    <div className="flex-shrink-0 bg-gray-900 border-b border-gray-700 px-2 py-1.5">
      {/* ヘッダー：タップ/クリックで開閉 */}
      <div
        className="flex items-center gap-1 cursor-pointer select-none"
        style={tap}
        onClick={toggleMyDeckSection}
      >
        <span className="text-xs text-orange-400 font-bold">
          📁 マイデッキ {myDeckSectionOpen ? '▼' : '▶'}
        </span>
        <span className="text-xs text-gray-600 ml-0.5">({userDecks.length})</span>
        {draggingDeckId && <span className="text-xs text-gray-500 ml-1">↕ ドラッグで移動</span>}
        {myDeckSectionOpen && (
          <button type="button" style={tap} onClick={e => { e.stopPropagation(); setShowNewFolder(v => !v); }}
            className="ml-auto text-xs px-1.5 py-0.5 bg-gray-800 active:bg-gray-600 text-gray-400 rounded border border-gray-600 select-none">
            {showNewFolder ? '✕' : '＋フォルダ'}
          </button>
        )}
      </div>

      {/* コンテンツ（開いているときのみ） */}
      {myDeckSectionOpen && (
        <div className="mt-1.5">
          {/* 新規フォルダ入力 */}
          {showNewFolder && (
            <div className="flex gap-1 mb-1.5">
              <input type="text" value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
                placeholder="フォルダ名" autoFocus
                className="flex-1 min-w-0 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs text-white" />
              <button type="button" style={tap} onClick={handleCreateFolder} disabled={!newFolderName.trim()}
                className="px-2 py-1 bg-orange-600 active:bg-orange-500 disabled:opacity-40 text-white rounded text-xs select-none">作成</button>
            </div>
          )}

          {/* ルートデッキ（フォルダなし） */}
          {(() => {
            const { className: dzClass, ...dzRest } = dropZoneProps('root');
            return (
              <div {...dzRest} data-drop-zone="root" className={`min-h-[28px] mb-1 p-0.5 rounded transition-colors ${dzClass}`}>
                {rootUserDecks.length > 0 ? (
                  <div className="overflow-x-auto">
                    <div className="flex gap-1.5" style={{ width: 'max-content' }}>
                      {rootUserDecks.map((d, i) => renderDeckChip(d, 'root', rootUserDecks, i))}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-gray-600 py-0.5">
                    {userDecks.length === 0 ? 'デッキがありません' : '（ルートにデッキなし）'}
                  </div>
                )}
              </div>
            );
          })()}

          {/* フォルダ一覧 */}
          {folders.map(folder => {
            const folderDecks = folder.deckIds
              .map(id => userDecks.find(d => d.id === id))
              .filter(Boolean) as Deck[];
            const { className: dzClass, ...dzRest } = dropZoneProps(folder.id);

            return (
              <div key={folder.id} className={`mb-1 border rounded transition-colors ${dragOverZone === folder.id ? 'border-orange-400' : 'border-gray-700'}`}>
                {/* フォルダヘッダー */}
                <div
                  {...dzRest}
                  data-drop-zone={folder.id}
                  className={`flex items-center gap-1 px-1.5 py-1 bg-gray-800 rounded-t ${dzClass}`}
                >
                  <button type="button" style={tap} onClick={() => toggleFolderOpen(folder.id)}
                    className="text-xs text-gray-300 font-bold flex items-center gap-1 flex-1 min-w-0 select-none">
                    <span>{folder.open ? '▼' : '▶'}</span>
                    {editFolderId === folder.id ? (
                      <input type="text" value={editFolderName} onChange={e => setEditFolderName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRenameFolder(folder.id); if (e.key === 'Escape') setEditFolderId(null); }}
                        onClick={e => e.stopPropagation()}
                        autoFocus
                        className="flex-1 min-w-0 px-1 py-0.5 bg-gray-700 border border-gray-500 rounded text-xs text-white" />
                    ) : (
                      <span className="truncate">{folder.name}</span>
                    )}
                    <span className="text-gray-500 ml-1 shrink-0">({folderDecks.length})</span>
                  </button>
                  {editFolderId === folder.id ? (
                    <>
                      <button type="button" style={tap} onClick={() => handleRenameFolder(folder.id)}
                        className="text-xs px-1.5 py-0.5 bg-green-700 active:bg-green-600 text-white rounded select-none">✓</button>
                      <button type="button" style={tap} onClick={() => setEditFolderId(null)}
                        className="text-xs px-1.5 py-0.5 bg-gray-600 active:bg-gray-500 text-white rounded select-none">✕</button>
                    </>
                  ) : confirmDeleteFolderId === folder.id ? (
                    <>
                      <span className="text-xs text-red-400 shrink-0">削除?</span>
                      <button type="button" style={tap} onClick={() => handleDeleteFolder(folder.id)}
                        className="text-xs px-1.5 py-0.5 bg-red-700 active:bg-red-600 text-white rounded select-none">はい</button>
                      <button type="button" style={tap} onClick={() => setConfirmDeleteFolderId(null)}
                        className="text-xs px-1.5 py-0.5 bg-gray-600 active:bg-gray-500 text-white rounded select-none">いいえ</button>
                    </>
                  ) : (
                    <>
                      <button type="button" style={tap}
                        onClick={() => { setEditFolderId(folder.id); setEditFolderName(folder.name); }}
                        className="text-xs px-1.5 py-0.5 bg-gray-700 active:bg-gray-600 text-gray-400 rounded select-none">✎</button>
                      <button type="button" style={tap} onClick={() => setConfirmDeleteFolderId(folder.id)}
                        className="text-xs px-1.5 py-0.5 bg-gray-700 active:bg-red-900 text-red-500 rounded select-none">×</button>
                    </>
                  )}
                </div>
                {/* フォルダ内デッキ（閉じていてもドロップゾーンとして機能） */}
                <div
                  data-drop-zone={folder.id}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverZone(folder.id); }}
                  onDragLeave={() => setDragOverZone(null)}
                  onDrop={e => { e.preventDefault(); handleDeckDrop(folder.id); }}
                  className={`px-1.5 py-1 overflow-x-auto ${!folder.open && folderDecks.length > 0 ? 'hidden' : ''}`}
                >
                  {folder.open && (
                    folderDecks.length > 0 ? (
                      <div className="flex gap-1.5" style={{ width: 'max-content' }}>
                        {folderDecks.map((d, i) => renderDeckChip(d, folder.id, folderDecks, i))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-600">（デッキなし）</div>
                    )
                  )}
                </div>
              </div>
            );
          })}

          {/* ── デッキ送受信 ───────────────────────────────────────────────────── */}
          <div className="mt-1.5 pt-1.5 border-t border-gray-700">
            <div className="flex gap-1.5">
              <button type="button" style={tap}
                onClick={() => { setShowExportPanel(v => !v); setShowImportPanel(false); setImportError(null); setImportSuccess(null); }}
                className={`flex-1 text-xs py-1 px-2 rounded border select-none transition-colors ${
                  showExportPanel
                    ? 'bg-orange-800 border-orange-500 text-orange-200'
                    : 'bg-gray-800 active:bg-gray-700 border-gray-600 text-gray-300'
                }`}>
                📤 デッキを送る
              </button>
              <button type="button" style={tap}
                onClick={() => { setShowImportPanel(v => !v); setShowExportPanel(false); setImportError(null); setImportSuccess(null); }}
                className={`flex-1 text-xs py-1 px-2 rounded border select-none transition-colors ${
                  showImportPanel
                    ? 'bg-blue-800 border-blue-500 text-blue-200'
                    : 'bg-gray-800 active:bg-gray-700 border-gray-600 text-gray-300'
                }`}>
                📥 デッキを受け取る
              </button>
            </div>

            {/* エクスポートパネル */}
            {showExportPanel && (
              <div className="mt-1.5 p-2 bg-gray-800 border border-orange-700 rounded">
                <p className="text-xs text-gray-400 mb-2 leading-relaxed">
                  デッキのデータをファイルに保存します。<br />
                  保存したファイルを相手に送ると、<br />
                  相手のモバナワでデッキを受け取れます。
                </p>
                <div className="flex gap-1">
                  <select
                    value={exportDeckId}
                    onChange={e => setExportDeckId(e.target.value)}
                    className="flex-1 min-w-0 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white"
                  >
                    <option value="">デッキを選択...</option>
                    {userDecks.map(d => {
                      const rCount = d.reserveCardIds?.length ?? 0;
                      const label = rCount > 0
                        ? `${d.name} (${d.cardIds.length}+${rCount})`
                        : `${d.name} (${d.cardIds.length}枚)`;
                      return <option key={d.id} value={d.id}>{label}</option>;
                    })}
                  </select>
                  <button type="button" style={tap}
                    onClick={handleExport}
                    disabled={!exportDeckId}
                    className="px-3 py-1 bg-orange-600 active:bg-orange-500 disabled:opacity-40 text-white rounded text-xs font-bold shrink-0 select-none">
                    送る
                  </button>
                </div>
              </div>
            )}

            {/* インポートパネル */}
            {showImportPanel && (
              <div className="mt-1.5 p-2 bg-gray-800 border border-blue-700 rounded">
                <p className="text-xs text-gray-400 mb-2 leading-relaxed">
                  受け取ったデッキファイルを選択してください。<br />
                  マイデッキに追加されます。<br />
                  同じ名前のデッキがある場合は<br />
                  末尾に番号が付きます。
                </p>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleImportFile}
                  className="hidden"
                />
                <button type="button" style={tap}
                  onClick={() => { setImportError(null); setImportSuccess(null); importInputRef.current?.click(); }}
                  className="w-full py-1.5 bg-blue-700 active:bg-blue-600 text-white rounded text-xs font-bold select-none">
                  ファイルを選択
                </button>
                {importError && (
                  <div className="mt-1.5 text-xs text-red-400 bg-red-950 border border-red-700 rounded px-2 py-1">
                    {importError}
                  </div>
                )}
                {importSuccess && (
                  <div className="mt-1.5 text-xs text-green-400 bg-green-950 border border-green-700 rounded px-2 py-1">
                    ✓ {importSuccess}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const sampleDeckList = sampleDecks.length > 0 ? (
    <div className="flex-shrink-0 bg-gray-900 border-b border-gray-700 px-2 py-1.5">
      <button type="button" style={tap} onClick={toggleSampleDeckSection}
        className="flex items-center gap-1 w-full text-left select-none mb-0.5">
        <span className="text-xs text-gray-500">{sampleDeckSectionOpen ? '▼' : '▶'}</span>
        <span className="text-xs text-gray-500 font-bold">📋 サンプルデッキ</span>
        {!sampleDeckSectionOpen && (
          <span className="text-xs text-gray-600 ml-1">({sampleDecks.length})</span>
        )}
      </button>
      {sampleDeckSectionOpen && (
        <div className="overflow-x-auto">
          <div className="flex gap-1.5" style={{ width: 'max-content' }}>
            {sampleDecks.map(deck => (
              <button key={deck.id} type="button" style={tap} onClick={() => handleLoadDeck(deck)}
                className={`text-xs px-2 py-1 rounded border leading-tight select-none ${
                  currentDeck?.id === deck.id
                    ? 'bg-gray-700 border-gray-400 text-gray-100'
                    : 'bg-gray-800 active:bg-gray-600 border-gray-600 text-gray-400'
                }`}>
                {deck.name}<span className="text-gray-600 ml-1">({deck.cardIds.length})</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  ) : null;

  // ── 選択済みカード（メイン15枚 + 予備6枚）────────────────────────────────────
  const selectedDeckSlots = (
    <div className="flex-shrink-0 bg-gray-900 border-b border-gray-700 px-2 pt-1.5 pb-2">
      {/* Stats row */}
      <div className="flex items-center gap-2 mb-1 text-xs flex-wrap">
        <span className="text-gray-400">総マス:<span className="text-white font-bold ml-0.5">{totalSize}</span></span>
        <span className="text-gray-400">SW:<span className="text-orange-400 font-bold ml-0.5">{swCount}</span></span>
        {sizeGroups.filter(g => g.count > 0).map(g => (
          <span key={g.label} className="text-gray-500">
            {g.label}:<span className="text-gray-300 font-bold">{g.count}</span>
          </span>
        ))}
        {isPreset && <span className="text-blue-400 text-xs ml-auto">「マイに保存」で新規作成</span>}
        {!isPreset && totalCards > 1 && (
          <span className="text-gray-600 text-xs ml-auto">長押し/ドラッグで入れ替え</span>
        )}
      </div>

      {/* Slot grid with ref for touch-drag passive listener */}
      <div ref={slotContainerRef} className="flex flex-col gap-1">
        {/* Main slots 0-14 */}
        <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))' }}>
          {Array.from({ length: 15 }).map((_, i) => renderDeckSlot(i, mainCards[i], i + 1))}
        </div>

        {/* Reserve separator + slots 15-17 */}
        <div>
          <div className="flex items-center gap-1 my-0.5">
            <div className="h-px flex-1 bg-gray-700" />
            <span className="text-xs text-gray-500 shrink-0 px-1">
              予備 ({reserveIds.length}/6)
            </span>
            <div className="h-px flex-1 bg-gray-700" />
          </div>
          {/* grid-cols-6: 6スロットを1行に。gap-0.5で隙間を最小化 */}
          <div className="grid grid-cols-6 gap-0.5">
            {Array.from({ length: 6 }).map((_, i) => renderDeckSlot(15 + i, reserveCards[i], `予${i + 1}`, true))}
          </div>
        </div>
      </div>
    </div>
  );

  const cardGrid = (
    <div className="flex flex-col flex-1 overflow-hidden min-h-0">
      <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1 bg-gray-900 border-b border-gray-700">
        {([
          { key: 'id' as SortKey, label: '番号' },
          { key: 'size' as SortKey, label: 'マス数' },
          { key: 'rarity' as SortKey, label: 'レア' },
          { key: 'name' as SortKey, label: '名前' },
        ]).map(({ key, label }) => {
          const active = sortKey === key;
          return (
            <button key={key} type="button" style={tap} onClick={() => toggleSort(key)}
              className={`px-2 py-0.5 rounded text-xs border select-none ${
                active
                  ? 'bg-orange-700 border-orange-500 text-white font-bold'
                  : 'bg-gray-800 border-gray-600 text-gray-400 active:border-gray-400'
              }`}>
              {label}{active ? (sortAsc ? '↑' : '↓') : ''}
            </button>
          );
        })}
        <span className="text-xs text-gray-600 ml-auto">{sortedCards.length}枚</span>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          <span className="text-xs text-gray-500 whitespace-nowrap">サイズ</span>
          <input
            type="range" min={2} max={6} step={1} value={cardCellSize}
            onChange={e => setCardCellSize(Number(e.target.value))}
            className="w-16"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardCellSize * 10}px, 1fr))` }}>
          {sortedCards.map(card => {
            const inDeck = mainIds.includes(card.id) || reserveIds.includes(card.id);
            const full   = totalCards >= 21;
            const disabled = inDeck || full;
            // カード名は優先的に大きく表示するため cellSize が大きいほどフォントも拡大
            const nameFontSize = `${6 + cardCellSize * 0.8}px`;
            const infoFontSize = `${5 + cardCellSize * 0.5}px`;
            return (
              <button key={card.id} type="button" disabled={disabled} onClick={() => addCard(card)}
                style={{ touchAction: 'manipulation', cursor: disabled ? 'not-allowed' : 'pointer' }}
                className={`p-0.5 rounded border text-left ${
                  disabled
                    ? 'border-gray-700 bg-gray-900 opacity-35'
                    : 'border-gray-700 bg-gray-800 active:border-orange-500 active:bg-gray-700'
                }`}>
                {/* 縦レイアウト: カード形状の下にカード名 */}
                <div className="flex flex-col items-center">
                  <CardShape shape={card.shape} specialPos={card.specialPos} cellSize={cardCellSize} p1Color="#FFE000" spColor="#FF4500" />
                  <div className="w-full mt-0.5 overflow-hidden">
                    <div className="text-white truncate leading-tight text-center" style={{ fontSize: nameFontSize }}>{card.name}</div>
                    <div className="text-gray-500 leading-tight text-center" style={{ fontSize: infoFontSize }}>
                      {card.size}m{card.spp > 0 ? ` S${card.spp}` : ''}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  // ─── Landscape layout (2カラム) ───────────────────────────────────────────────
  if (isLandscape) {
    return (
      <div className="flex flex-row bg-gray-950" style={{ height: '100%' }}>
        {/* 左カラム：デッキ一覧・作成中デッキ */}
        <div className="flex flex-col overflow-y-auto border-r border-gray-700" style={{ width: '50%' }}>
          {deckFormBar}
          {myDeckList}
          {sampleDeckList}
          {selectedDeckSlots}
        </div>
        {/* 右カラム：カード一覧＋ソートタブ */}
        <div className="flex flex-col overflow-hidden" style={{ width: '50%' }}>
          {cardGrid}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-gray-950" style={{ height: '100%' }}>
      {deckFormBar}
      {myDeckList}
      {sampleDeckList}
      {selectedDeckSlots}
      {cardGrid}
    </div>
  );
}
