import { create } from 'zustand';
import type { Card, Deck, DeckFolder, AppMode } from '../types';
import cardsData from '../data/cards.json';

function generateId(): string {
  try { return crypto.randomUUID(); } catch {}
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

const CARDS_KEY   = 'nawabattler_cards';
const DECKS_KEY   = 'nawabattler_decks';
const FOLDERS_KEY = 'nawabattler_folders';

function loadCards(): Card[] {
  try {
    const saved = localStorage.getItem(CARDS_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return cardsData as Card[];
}

const FULL_DECK: Deck = {
  id: 'all',
  name: '全カード',
  cardIds: (cardsData as Card[]).map(c => c.id),
  createdAt: 0,
  updatedAt: 0,
};

const PRESET_DECKS: Deck[] = [
  {
    id: 'starter',
    name: 'スターター',
    cardIds: ['6', '13', '22', '28', '34', '40', '45', '52', '55', '56', '92', '103', '137', '141', '159'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'bukichi',
    name: 'ブキチ',
    cardIds: ['10', '14', '24', '25', '31', '37', '42', '48', '50', '53', '54', '59', '61', '84', '85'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'omura',
    name: 'オームラ',
    cardIds: ['12', '20', '44', '53', '69', '75', '86', '105', '109', '110', '113', '118', '125', '143', '161'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'hanagasa',
    name: 'ハナガサ',
    cardIds: ['64', '73', '87', '105', '106', '108', '111', '112', '113', '114', '115', '117', '118', '119', '128'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'yashigani',
    name: 'ヤシガニさん',
    cardIds: ['10', '23', '31', '38', '40', '41', '62', '81', '88', '105', '113', '114', '131', '135', '154'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'palco',
    name: 'パル子',
    cardIds: ['20', '30', '40', '67', '68', '80', '89', '114', '116', '119', '129', '138', '146', '147', '155'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'judge',
    name: 'ジャッジくん',
    cardIds: ['6', '16', '23', '25', '29', '35', '43', '59', '63', '70', '101', '102', '160', '161', '162'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'kojudge',
    name: 'コジャッジくん',
    cardIds: ['79', '91', '93', '102', '141', '142', '144', '145', '146', '147', '148', '149', '150', '155', '157'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'spiky',
    name: 'スパイキー',
    cardIds: ['26', '33', '50', '51', '59', '65', '66', '68', '76', '90', '103', '104', '108', '119', '136'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'fuka',
    name: 'フウカ',
    cardIds: ['52', '53', '59', '68', '69', '82', '98', '99', '100', '127', '132', '133', '147', '148', '152'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'utsuho',
    name: 'ウツホ',
    cardIds: ['54', '55', '57', '61', '72', '98', '99', '100', '122', '124', '135', '137', '145', '151', '159'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'mantaro',
    name: 'マンタロー',
    cardIds: ['52', '56', '58', '64', '66', '67', '69', '83', '98', '99', '100', '125', '127', '128', '155'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'staff',
    name: 'スタッフさん',
    cardIds: ['3', '18', '39', '56', '57', '58', '61', '62', '63', '64', '67', '69', '74', '92', '121'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'atarme',
    name: 'アタリメ',
    cardIds: ['1', '32', '77', '93', '94', '95', '120', '121', '122', '124', '127', '134', '139', '140', '159'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'ichigo',
    name: '1号',
    cardIds: ['21', '22', '23', '24', '57', '62', '71', '96', '97', '124', '128', '129', '133', '135', '140'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'nigo',
    name: '2号',
    cardIds: ['27', '28', '29', '30', '31', '32', '33', '51', '56', '60', '66', '78', '85', '96', '97'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'mamebukichi',
    name: 'マメブキチ',
    cardIds: ['9', '21', '25', '29', '35', '85', '103', '108', '166', '169', '171', '186', '187', '189', '190'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'anemo',
    name: 'アネモ',
    cardIds: ['66', '69', '71', '86', '105', '115', '134', '136', '139', '159', '169', '173', '179', '182', '191'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'echizen',
    name: 'エチゼン',
    cardIds: ['3', '10', '41', '55', '59', '60', '78', '87', '116', '119', '170', '173', '180', '192', '198'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'azio',
    name: 'アジオ',
    cardIds: ['79', '93', '113', '114', '120', '124', '127', '129', '132', '133', '135', '141', '147', '153', '193'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'downey',
    name: 'ダウニー',
    cardIds: ['23', '52', '53', '54', '59', '66', '90', '105', '111', '113', '118', '136', '152', '188', '194'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'miura',
    name: 'ミウラ',
    cardIds: ['13', '20', '58', '67', '69', '74', '86', '90', '105', '168', '173', '175', '191', '223', '245'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'bizen',
    name: 'ビゼン',
    cardIds: ['33', '34', '57', '59', '64', '77', '87', '111', '119', '137', '173', '180', '192', '198', '246'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'shiganey',
    name: 'シガニー',
    cardIds: ['59', '81', '88', '104', '106', '112', '113', '158', '159', '165', '193', '203', '219', '243', '247'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'hime',
    name: 'ヒメ',
    cardIds: ['8', '32', '78', '94', '174', '175', '178', '224', '233', '235', '241', '243', '250', '251', '252'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'iida',
    name: 'イイダ',
    cardIds: ['10', '49', '57', '73', '124', '127', '135', '208', '225', '236', '244', '248', '250', '251', '252'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'mizuta',
    name: 'ミズタ',
    cardIds: ['95', '120', '126', '127', '128', '132', '133', '135', '137', '139', '232', '233', '248', '251', '252'],
    createdAt: 0,
    updatedAt: 0,
  },
];

const PRESET_DECK_IDS = new Set([FULL_DECK.id, ...PRESET_DECKS.map(d => d.id)]);

/** Returns true if the deck is a built-in sample deck (not user-created, not FULL_DECK). */
export function isSampleDeck(id: string): boolean {
  return PRESET_DECK_IDS.has(id) && id !== FULL_DECK.id;
}

function loadFolders(): DeckFolder[] {
  try {
    const saved = localStorage.getItem(FOLDERS_KEY);
    if (saved) return JSON.parse(saved) as DeckFolder[];
  } catch {}
  return [];
}

function saveFoldersToDB(folders: DeckFolder[]) {
  try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders)); } catch {}
}

function loadDecks(): Deck[] {
  try {
    const saved = localStorage.getItem(DECKS_KEY);
    if (saved) {
      const userDecks = (JSON.parse(saved) as Deck[]).filter(d => !PRESET_DECK_IDS.has(d.id));
      return [FULL_DECK, ...userDecks, ...PRESET_DECKS];
    }
  } catch {}
  return [FULL_DECK, ...PRESET_DECKS];
}

interface AppStore {
  mode: AppMode;
  setMode: (mode: AppMode) => void;

  cards: Card[];
  addCards: (newCards: Card[]) => void;
  updateCard: (id: string, updates: Partial<Card>) => void;

  decks: Deck[];
  currentDeck: Deck | null;
  saveDeck: (deck: Deck) => void;
  deleteDeck: (id: string) => void;
  setCurrentDeck: (deck: Deck | null) => void;
  newDeck: () => void;

  folders: DeckFolder[];
  saveFolder: (folder: DeckFolder) => void;
  deleteFolder: (id: string) => void;
  moveDeckToFolder: (deckId: string, folderId: string | null, insertBeforeId?: string | null) => void;
  reorderRootDecks: (deckId: string, insertBeforeId: string | null) => void;
  toggleFolderOpen: (id: string) => void;

  p1DeckId: string | null;
  p2DeckId: string | null;
  setP1DeckId: (id: string | null) => void;
  setP2DeckId: (id: string | null) => void;
}

export const useStore = create<AppStore>((set, get) => ({
  mode: 'deckbuilder',
  setMode: (mode) => set({ mode }),

  cards: loadCards(),
  addCards: (newCards) => {
    const current = get().cards;
    const merged = [...current];
    for (const c of newCards) {
      if (!merged.find(x => x.id === c.id)) merged.push(c);
    }
    localStorage.setItem(CARDS_KEY, JSON.stringify(merged));
    set({ cards: merged });
  },
  updateCard: (id, updates) => {
    const cards = get().cards.map(c => c.id === id ? { ...c, ...updates } : c);
    localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
    set({ cards });
  },

  decks: loadDecks(),
  currentDeck: null,
  saveDeck: (deck) => {
    if (PRESET_DECK_IDS.has(deck.id)) return; // プリセットは上書きしない
    const userDecks = get().decks.filter(d => !PRESET_DECK_IDS.has(d.id));
    const idx = userDecks.findIndex(d => d.id === deck.id);
    const updatedUser = idx >= 0
      ? userDecks.map(d => d.id === deck.id ? deck : d)
      : [...userDecks, deck];
    if (updatedUser.length > 64) updatedUser.splice(0, updatedUser.length - 64);
    try {
      localStorage.setItem(DECKS_KEY, JSON.stringify(updatedUser));
    } catch (e) {
      console.warn('localStorage save failed:', e);
    }
    set({ decks: [FULL_DECK, ...updatedUser, ...PRESET_DECKS], currentDeck: deck });
  },
  deleteDeck: (id) => {
    if (PRESET_DECK_IDS.has(id)) return; // プリセットは削除しない
    const userDecks = get().decks.filter(d => !PRESET_DECK_IDS.has(d.id) && d.id !== id);
    try {
      localStorage.setItem(DECKS_KEY, JSON.stringify(userDecks));
    } catch { /* ignore */ }
    const current = get().currentDeck;
    set({ decks: [FULL_DECK, ...userDecks, ...PRESET_DECKS], currentDeck: current?.id === id ? null : current });
  },
  setCurrentDeck: (deck) => set({ currentDeck: deck }),
  newDeck: () => {
    const deck: Deck = {
      id: generateId(),
      name: '新しいデッキ',
      cardIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set({ currentDeck: deck });
  },

  folders: loadFolders(),
  saveFolder: (folder) => {
    const folders = get().folders;
    const idx = folders.findIndex(f => f.id === folder.id);
    const updated = idx >= 0
      ? folders.map(f => f.id === folder.id ? folder : f)
      : [...folders, folder];
    saveFoldersToDB(updated);
    set({ folders: updated });
  },
  deleteFolder: (id) => {
    // Move all decks in this folder out (to root) by removing folderId reference
    const folders = get().folders.filter(f => f.id !== id);
    saveFoldersToDB(folders);
    set({ folders });
  },
  moveDeckToFolder: (deckId, folderId, insertBeforeId) => {
    const folders = get().folders.map(f => ({
      ...f,
      deckIds: f.deckIds.filter(id => id !== deckId),
    }));
    if (folderId) {
      const updated = folders.map(f => {
        if (f.id !== folderId) return f;
        const ids = [...f.deckIds];
        if (insertBeforeId != null) {
          const pos = ids.indexOf(insertBeforeId);
          pos >= 0 ? ids.splice(pos, 0, deckId) : ids.push(deckId);
        } else {
          ids.push(deckId);
        }
        return { ...f, deckIds: ids };
      });
      saveFoldersToDB(updated);
      set({ folders: updated });
    } else {
      saveFoldersToDB(folders);
      set({ folders });
    }
  },
  reorderRootDecks: (deckId, insertBeforeId) => {
    const userDecks = get().decks.filter(d => !PRESET_DECK_IDS.has(d.id));
    const dragged = userDecks.find(d => d.id === deckId);
    if (!dragged) return;
    const rest = userDecks.filter(d => d.id !== deckId);
    if (insertBeforeId != null) {
      const pos = rest.findIndex(d => d.id === insertBeforeId);
      pos >= 0 ? rest.splice(pos, 0, dragged) : rest.push(dragged);
    } else {
      rest.push(dragged);
    }
    try { localStorage.setItem(DECKS_KEY, JSON.stringify(rest)); } catch {}
    set({ decks: [FULL_DECK, ...rest, ...PRESET_DECKS] });
  },
  toggleFolderOpen: (id) => {
    const folders = get().folders.map(f =>
      f.id === id ? { ...f, open: !f.open } : f
    );
    saveFoldersToDB(folders);
    set({ folders });
  },

  p1DeckId: null,
  p2DeckId: null,
  setP1DeckId: (id) => set({ p1DeckId: id }),
  setP2DeckId: (id) => set({ p2DeckId: id }),
}));
