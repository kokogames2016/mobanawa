import type { CellState, PieceShape, PlaceAction } from '../types';
import { rotateShape } from './cardShape';

export function canPlace(
  grid: CellState[][],
  shape: PieceShape,
  x: number,
  y: number,
  player: 'p1' | 'p2',
  isSpecial: boolean,
  skipAdjacency = false
): boolean {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const ownNormal: CellState = player === 'p1' ? 'p1' : 'p2';
  const ownSP: CellState = player === 'p1' ? 'p1_sp' : 'p2_sp';
  const oppSP: CellState = player === 'p1' ? 'p2_sp' : 'p1_sp';

  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const gr = y + r;
      const gc = x + c;
      if (gr < 0 || gr >= rows || gc < 0 || gc >= cols) return false;
      const cell = grid[gr][gc];
      // Always block walls, stage obstacles, and collision stones
      if (cell === 'W' || cell === 'B' || cell === 'blocked') return false;
      if (isSpecial) {
        // SA: can overwrite own cells (normal+SP) and opponent normal cells
        // Only opponent SP squares (and walls/blocked handled above) are blocked
        if (cell === oppSP) return false;
      } else {
        // Normal: all occupied cells blocked
        if (cell === 'p1' || cell === 'p2' || cell === 'p1_sp' || cell === 'p2_sp') return false;
      }
    }
  }

  // フリー配置モード: 隣接チェックをスキップ
  if (skipAdjacency) return true;

  // Adjacency check: if own cells already exist on board, new piece must touch at least one
  const ownCells: CellState[] = player === 'p1' ? ['p1', 'p1_sp'] : ['p2', 'p2_sp'];
  // SA must be adjacent to own SP squares only; normal placement touches any own cell
  const adjCells: CellState[] = isSpecial
    ? (player === 'p1' ? ['p1_sp'] : ['p2_sp'])
    : ownCells;
  let hasOwnCells = false;
  outer_check: for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (ownCells.includes(grid[r][c])) { hasOwnCells = true; break outer_check; }
    }
  }
  if (hasOwnCells) {
    let adjacent = false;
    adj_check: for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const gr = y + r;
        const gc = x + c;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = gr + dr;
            const nc = gc + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            if (adjCells.includes(grid[nr][nc])) { adjacent = true; break adj_check; }
          }
        }
      }
    }
    if (!adjacent) return false;
  }

  return true;
}

function rotateSpecialPos(
  pos: [number, number] | null | undefined,
  rotation: 0 | 90 | 180 | 270,
  origRows: number,
  origCols: number
): [number, number] | null {
  if (!pos) return null;
  const [sr, sc] = pos;
  switch (rotation) {
    case 0:   return [sr, sc];
    case 90:  return [sc, origRows - 1 - sr];
    case 180: return [origRows - 1 - sr, origCols - 1 - sc];
    case 270: return [origCols - 1 - sc, sr];
  }
}

export function placeCard(
  grid: CellState[][],
  shape: PieceShape,
  x: number,
  y: number,
  player: 'p1' | 'p2',
  specialPos: [number, number] | null | undefined,
  rotation: 0 | 90 | 180 | 270,
  _isSpecial: boolean
): CellState[][] {
  const newGrid = grid.map(row => [...row]);
  const origRows = shape.length;
  const origCols = shape[0]?.length ?? 0;
  const rotated = rotateShape(shape, rotation);
  const playerCell: CellState = player === 'p1' ? 'p1' : 'p2';
  const spCell: CellState = player === 'p1' ? 'p1_sp' : 'p2_sp';
  const rotatedSP = rotateSpecialPos(specialPos, rotation, origRows, origCols);

  for (let r = 0; r < rotated.length; r++) {
    for (let c = 0; c < rotated[r].length; c++) {
      if (!rotated[r][c]) continue;
      const gr = y + r;
      const gc = x + c;
      const isSP = rotatedSP && rotatedSP[0] === r && rotatedSP[1] === c;
      newGrid[gr][gc] = isSP ? spCell : playerCell;
    }
  }
  return newGrid;
}

export function resolveSimultaneous(
  grid: CellState[][],
  p1Action: PlaceAction | 'pass',
  p2Action: PlaceAction | 'pass',
  getShape: (cardId: string) => PieceShape | null,
  getSpecialPos: (cardId: string) => [number, number] | null | undefined,
  getSize: (cardId: string) => number
): CellState[][] {
  const newGrid = grid.map(row => [...row]);

  if (p1Action === 'pass' && p2Action === 'pass') return newGrid;

  // Single-player placement
  if (p1Action !== 'pass' && p2Action === 'pass') {
    const shape = getShape(p1Action.cardId);
    if (!shape) return newGrid;
    return placeCard(newGrid, shape, p1Action.x, p1Action.y, 'p1', getSpecialPos(p1Action.cardId), p1Action.rotation, false);
  }
  if (p1Action === 'pass' && p2Action !== 'pass') {
    const shape = getShape(p2Action.cardId);
    if (!shape) return newGrid;
    return placeCard(newGrid, shape, p2Action.x, p2Action.y, 'p2', getSpecialPos(p2Action.cardId), p2Action.rotation, false);
  }
  if (p1Action === 'pass' || p2Action === 'pass') return newGrid;

  // Both place — resolve cell by cell
  const p1Shape = getShape(p1Action.cardId);
  const p2Shape = getShape(p2Action.cardId);
  if (!p1Shape || !p2Shape) return newGrid;

  const p1Size = getSize(p1Action.cardId);
  const p2Size = getSize(p2Action.cardId);

  const rotP1 = rotateShape(p1Shape, p1Action.rotation);
  const rotP2 = rotateShape(p2Shape, p2Action.rotation);
  const rSP1 = rotateSpecialPos(getSpecialPos(p1Action.cardId), p1Action.rotation, p1Shape.length, p1Shape[0]?.length ?? 0);
  const rSP2 = rotateSpecialPos(getSpecialPos(p2Action.cardId), p2Action.rotation, p2Shape.length, p2Shape[0]?.length ?? 0);

  // Build position maps: "row,col" → isSP
  const p1Map = new Map<string, boolean>();
  const p2Map = new Map<string, boolean>();

  for (let r = 0; r < rotP1.length; r++)
    for (let c = 0; c < rotP1[r].length; c++) {
      if (!rotP1[r][c]) continue;
      p1Map.set(`${p1Action.y + r},${p1Action.x + c}`, !!(rSP1 && rSP1[0] === r && rSP1[1] === c));
    }

  for (let r = 0; r < rotP2.length; r++)
    for (let c = 0; c < rotP2[r].length; c++) {
      if (!rotP2[r][c]) continue;
      p2Map.set(`${p2Action.y + r},${p2Action.x + c}`, !!(rSP2 && rSP2[0] === r && rSP2[1] === c));
    }

  // Apply non-overlapping cells
  for (const [key, isSP] of p1Map)
    if (!p2Map.has(key)) {
      const [gr, gc] = key.split(',').map(Number);
      newGrid[gr][gc] = isSP ? 'p1_sp' : 'p1';
    }
  for (const [key, isSP] of p2Map)
    if (!p1Map.has(key)) {
      const [gr, gc] = key.split(',').map(Number);
      newGrid[gr][gc] = isSP ? 'p2_sp' : 'p2';
    }

  // Resolve overlapping cells by priority rules
  for (const [key, p1SP] of p1Map) {
    if (!p2Map.has(key)) continue;
    const p2SP = p2Map.get(key)!;
    const [gr, gc] = key.split(',').map(Number);

    if (p1SP && p2SP) {
      // Both SP → same rule as normal vs normal: smaller size wins
      if (p1Size < p2Size) newGrid[gr][gc] = 'p1_sp';
      else if (p2Size < p1Size) newGrid[gr][gc] = 'p2_sp';
      else newGrid[gr][gc] = 'blocked';
    } else if (p1SP && !p2SP) {
      // p1 SP beats p2 normal
      newGrid[gr][gc] = 'p1_sp';
    } else if (!p1SP && p2SP) {
      // p2 SP beats p1 normal
      newGrid[gr][gc] = 'p2_sp';
    } else {
      // Both normal → smaller size wins; same size → blocked (石)
      if (p1Size < p2Size) newGrid[gr][gc] = 'p1';
      else if (p2Size < p1Size) newGrid[gr][gc] = 'p2';
      else newGrid[gr][gc] = 'blocked';
    }
  }

  return newGrid;
}

function getCells(shape: PieceShape, x: number, y: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c]) cells.push([y + r, x + c]);
    }
  }
  return cells;
}

function isActivatedSP(grid: CellState[][], r: number, c: number): boolean {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (grid[nr][nc] === 'E') return false;
    }
  }
  return true;
}

/** Returns positions of ALL p1_sp / p2_sp cells, regardless of activation status. */
export function getAllSPPositions(grid: CellState[][]): { p1: [number, number][]; p2: [number, number][] } {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const p1: [number, number][] = [];
  const p2: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 'p1_sp') p1.push([r, c]);
      else if (grid[r][c] === 'p2_sp') p2.push([r, c]);
    }
  }
  return { p1, p2 };
}

export function getActivatedSPPositions(grid: CellState[][]): { p1: [number, number][]; p2: [number, number][] } {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const p1: [number, number][] = [];
  const p2: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (cell !== 'p1_sp' && cell !== 'p2_sp') continue;
      if (isActivatedSP(grid, r, c)) {
        if (cell === 'p1_sp') p1.push([r, c]);
        else p2.push([r, c]);
      }
    }
  }
  return { p1, p2 };
}

export function countActivatedSP(grid: CellState[][]): { p1: number; p2: number } {
  const pos = getActivatedSPPositions(grid);
  return { p1: pos.p1.length, p2: pos.p2.length };
}

export function countCells(grid: CellState[][]): { p1: number; p2: number; empty: number; wall: number } {
  let p1 = 0, p2 = 0, empty = 0, wall = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell === 'p1' || cell === 'p1_sp') p1++;
      else if (cell === 'p2' || cell === 'p2_sp') p2++;
      else if (cell === 'W' || cell === 'B') wall++;
      else empty++;
    }
  }
  return { p1, p2, empty, wall };
}

export function shuffleDeck(deck: string[]): string[] {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Returns true if the given shape has at least one valid placement on the grid. */
export function hasAnyValidPlacement(
  grid: CellState[][],
  shape: PieceShape,
  player: 'p1' | 'p2',
  isSpecial: boolean,
  skipAdjacency = false
): boolean {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const rotations: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
  for (const rot of rotations) {
    const rotated = rotateShape(shape, rot);
    const h = rotated.length;
    const w = rotated[0]?.length ?? 0;
    for (let y = -(h - 1); y < rows; y++) {
      for (let x = -(w - 1); x < cols; x++) {
        if (canPlace(grid, rotated, x, y, player, isSpecial, skipAdjacency)) return true;
      }
    }
  }
  return false;
}
