export type PieceShape = boolean[][];

export type Rarity = 'common' | 'rare' | 'fresh';

export interface Card {
  id: string;
  name: string;
  size: number;
  spp: number;
  hasSpecialSquare: boolean;
  specialPos?: [number, number] | null;
  shape: PieceShape | null;
  rarity: Rarity;
  imageUrl?: string;
}

export interface Deck {
  id: string;
  name: string;
  cardIds: string[];          // main slots, up to 15
  reserveCardIds?: string[];  // reserve slots, up to 3
  createdAt: number;
  updatedAt: number;
}

export interface DeckFolder {
  id: string;
  name: string;
  deckIds: string[];
  open: boolean;
  createdAt: number;
}

export type CellState =
  | 'E'       // empty
  | 'W'       // wall (stage shape)
  | 'B'       // blocked/pre-existing obstacle
  | 'p1'      // player 1 painted
  | 'p2'      // player 2 painted
  | 'p1_sp'   // player 1 special square
  | 'p2_sp'   // player 2 special square
  | 'blocked'; // collision-created wall

export interface Stage {
  id: string;
  name: string;
  width: number;
  height: number;
  initialGrid: CellState[][];
  p1Start?: [number, number];
  p2Start?: [number, number];
}

export interface PlaceAction {
  cardId: string;
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  isSpecialAttack: boolean;
}

export interface TurnRecord {
  turn: number;
  p1Action: PlaceAction | 'pass';
  p2Action: PlaceAction | 'pass';
  gridSnapshot: CellState[][];
  p1SP: number;
  p2SP: number;
  p1SpentSP: number;
  p2SpentSP: number;
}

export interface BoardState {
  stageId: string;
  grid: CellState[][];
  p1Deck: string[];
  p2Deck: string[];
  p1Hand: string[];
  p2Hand: string[];
  p1SP: number;
  p2SP: number;
  turn: number;
  history: TurnRecord[];
}

export type AppMode = 'deckbuilder' | 'boardsim' | 'battle' | 'drawsim';
export type CpuLevel = 1 | 2 | 3 | 4;
