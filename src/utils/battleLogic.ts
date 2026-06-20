import type { Card, CellState, CpuLevel } from '../types';
import { rotateShape } from './cardShape';
import { canPlace } from './boardLogic';

export type Rotation = 0 | 90 | 180 | 270;

export interface CpuMove {
  cardId: string;
  x: number;
  y: number;
  rotation: Rotation;
  isSA: boolean;
  cardName: string;
}

export interface StageInfo {
  p1StartRow: number;
  p2StartRow: number;
  p1StartCol: number;
  p2StartCol: number;
  rows: number;
  cols: number;
}

const ALL_ROTATIONS: Rotation[] = [0, 90, 180, 270];

// ─── 全有効配置列挙 ──────────────────────────────────────────────────────────

export function getAllValidPlacements(
  grid: CellState[][],
  card: Card,
  player: 'p1' | 'p2',
  isSA = false
): Array<{ x: number; y: number; rotation: Rotation }> {
  if (!card.shape) return [];
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const results: Array<{ x: number; y: number; rotation: Rotation }> = [];
  for (const rotation of ALL_ROTATIONS) {
    const shape = rotateShape(card.shape, rotation);
    const rRows = shape.length, rCols = shape[0]?.length ?? 0;
    // hasAnyValidPlacement と同様に負座標から探索（回転後に先頭行/列が空のシェイプでも見逃さない）
    for (let y = -(rRows - 1); y < rows; y++)
      for (let x = -(rCols - 1); x < cols; x++)
        if (canPlace(grid, shape, x, y, player, isSA, false))
          results.push({ x, y, rotation });
  }
  return results;
}

// ─── 配置シミュレーション ────────────────────────────────────────────────────

function simulateGrid(
  grid: CellState[][], card: Card,
  x: number, y: number, rotation: Rotation,
  player: 'p1' | 'p2'
): CellState[][] {
  if (!card.shape) return grid;
  const shape = rotateShape(card.shape, rotation);
  const newGrid = grid.map(row => [...row]);
  const cellType: CellState = player === 'p1' ? 'p1' : 'p2';
  const spType: CellState   = player === 'p1' ? 'p1_sp' : 'p2_sp';
  const origRows = card.shape.length, origCols = card.shape[0]?.length ?? 0;
  let rotatedSP: [number, number] | null = null;
  if (card.specialPos) {
    const [sr, sc] = card.specialPos;
    switch (rotation) {
      case 0:   rotatedSP = [sr, sc]; break;
      case 90:  rotatedSP = [sc, origRows - 1 - sr]; break;
      case 180: rotatedSP = [origRows - 1 - sr, origCols - 1 - sc]; break;
      case 270: rotatedSP = [origCols - 1 - sc, sr]; break;
    }
  }
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < (shape[r]?.length ?? 0); c++) {
      if (!shape[r][c]) continue;
      const gr = y + r, gc = x + c;
      if (gr < 0 || gr >= newGrid.length || gc < 0 || gc >= (newGrid[0]?.length ?? 0)) continue;
      const isSPCell = rotatedSP && rotatedSP[0] === r && rotatedSP[1] === c;
      const ex = newGrid[gr][gc];
      if (ex !== 'W' && ex !== 'B' && ex !== 'blocked')
        newGrid[gr][gc] = isSPCell ? spType : cellType;
    }
  return newGrid;
}

// ─── 危険地帯（侵入可能ギャップ）検出 ───────────────────────────────────────

export interface DangerInfo {
  cells: Set<string>;              // 危険地帯の全空きマス "r,c"
  regions: Array<Set<string>>;    // 危険地帯の連結領域ごとのセット
}

/**
 * P2陣地に隣接する空きマス連結領域のうち、
 * いずれかのカード（全回転）が完全に収まる領域を「危険地帯」として返す。
 * P2陣地から縦横8マス（チェビシェフ距離8）以内のみを対象にする。
 */
export function computeDangerZones(grid: CellState[][], allCards: Card[]): DangerInfo {
  const empty: DangerInfo = { cells: new Set(), regions: [] };
  if (allCards.length === 0) return empty;

  const rows = grid.length, cols = grid[0]?.length ?? 0;

  // P2陣地から8マス以内の空きマスをフィルタリング
  const RANGE = 8;
  const inRange = new Set<string>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 'p2' && grid[r][c] !== 'p2_sp') continue;
      for (let dr = -RANGE; dr <= RANGE; dr++) {
        for (let dc = -RANGE; dc <= RANGE; dc++) {
          const nr = r+dr, nc = c+dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === 'E') {
            inRange.add(`${nr},${nc}`);
          }
        }
      }
    }
  }
  if (inRange.size === 0) return empty;

  // 連結領域ごとにBFSし、P2隣接かつカードが収まる領域を危険地帯とする
  const visited = new Set<string>();
  const resultCells = new Set<string>();
  const resultRegions: Array<Set<string>> = [];

  for (const key of inRange) {
    if (visited.has(key)) continue;
    const [startR, startC] = key.split(',').map(Number);
    const region: [number, number][] = [];
    const localVis = new Set<string>([key]);
    const q: [number, number][] = [[startR, startC]];
    let adjToP2 = false;

    for (let qi = 0; qi < q.length; qi++) {
      const [r, c] = q[qi];
      region.push([r, c]);
      visited.add(`${r},${c}`);
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
        const nr = r+dr, nc = c+dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const cell = grid[nr][nc];
        if (cell === 'p2' || cell === 'p2_sp') { adjToP2 = true; continue; }
        if (cell === 'E' && !localVis.has(`${nr},${nc}`)) {
          localVis.add(`${nr},${nc}`); q.push([nr, nc]);
        }
      }
    }

    if (!adjToP2 || region.length === 0) continue;

    // 任意のカード形状がこの領域に完全に収まるか判定
    const regionSet = new Set(region.map(([r, c]) => `${r},${c}`));
    const minR = region.reduce((m, [r]) => Math.min(m, r), Infinity);
    const maxR = region.reduce((m, [r]) => Math.max(m, r), -Infinity);
    const minC = region.reduce((m, [, c]) => Math.min(m, c), Infinity);
    const maxC = region.reduce((m, [, c]) => Math.max(m, c), -Infinity);

    let isDanger = false;
    outerCard: for (const card of allCards) {
      if (!card.shape) continue;
      for (const rot of [0, 90, 180, 270] as const) {
        const shape = rotateShape(card.shape, rot);
        const h = shape.length, w = shape[0]?.length ?? 0;
        for (let py = minR - h + 1; py <= maxR; py++) {
          for (let px = minC - w + 1; px <= maxC; px++) {
            let fits = true;
            outer2: for (let r = 0; r < h; r++) {
              for (let c = 0; c < (shape[r]?.length ?? 0); c++) {
                if (!shape[r][c]) continue;
                if (!regionSet.has(`${py+r},${px+c}`)) { fits = false; break outer2; }
              }
            }
            if (fits) { isDanger = true; break outerCard; }
          }
        }
      }
    }

    if (isDanger) {
      const regionSetCopy = new Set(regionSet);
      for (const k of regionSet) resultCells.add(k);
      resultRegions.push(regionSetCopy);
    }
  }

  return { cells: resultCells, regions: resultRegions };
}

// ─── 壁判定（BFS） ──────────────────────────────────────────────────────────

function isWallCell(c: CellState): boolean {
  return c === 'p2' || c === 'p2_sp' || c === 'W' || c === 'B' || c === 'blocked';
}

/** P2+壁+石で左端→右端が連続しているか（横方向の壁） */
function checkWallH(grid: CellState[][]): boolean {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const vis = Array.from({ length: rows }, () => new Uint8Array(cols));
  const q: [number, number][] = [];
  for (let r = 0; r < rows; r++)
    if (isWallCell(grid[r][0])) { vis[r][0] = 1; q.push([r, 0]); }
  for (let qi = 0; qi < q.length; qi++) {
    const [r, c] = q[qi];
    if (c === cols - 1) return true;
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r+dr, nc = c+dc;
      if (nr>=0&&nr<rows&&nc>=0&&nc<cols&&!vis[nr][nc]&&isWallCell(grid[nr][nc])) {
        vis[nr][nc] = 1; q.push([nr, nc]);
      }
    }
  }
  return false;
}

/** P2+壁+石で上端→下端が連続しているか（縦方向の壁） */
function checkWallV(grid: CellState[][]): boolean {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const vis = Array.from({ length: rows }, () => new Uint8Array(cols));
  const q: [number, number][] = [];
  for (let c = 0; c < cols; c++)
    if (isWallCell(grid[0][c])) { vis[0][c] = 1; q.push([0, c]); }
  for (let qi = 0; qi < q.length; qi++) {
    const [r, c] = q[qi];
    if (r === rows - 1) return true;
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r+dr, nc = c+dc;
      if (nr>=0&&nr<rows&&nc>=0&&nc<cols&&!vis[nr][nc]&&isWallCell(grid[nr][nc])) {
        vis[nr][nc] = 1; q.push([nr, nc]);
      }
    }
  }
  return false;
}

/** 横・縦どちらかで壁が形成されているか */
export function checkWallFormation(grid: CellState[][]): boolean {
  return checkWallH(grid) || checkWallV(grid);
}

// ─── 評価補助関数 ────────────────────────────────────────────────────────────

function countType(grid: CellState[][], ...types: CellState[]): number {
  let n = 0;
  for (const row of grid) for (const c of row) if (types.includes(c)) n++;
  return n;
}

function countFullySurroundedSP(grid: CellState[][]): number {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  let count = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 'p2_sp') continue;
      let ok = true;
      outer: for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (dr===0&&dc===0) continue;
          const nr=r+dr,nc=c+dc;
          if (nr<0||nr>=rows||nc<0||nc>=cols||grid[nr][nc]==='E') { ok=false; break outer; }
        }
      if (ok) count++;
    }
  return count;
}

function countP1Opportunities(grid: CellState[][]): number {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  let n = 0;
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
    if (grid[r][c]!=='E') continue;
    for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
      if (dr===0&&dc===0) continue;
      const nr=r+dr,nc=c+dc;
      if (nr>=0&&nr<rows&&nc>=0&&nc<cols&&(grid[nr][nc]==='p1'||grid[nr][nc]==='p1_sp')) { n++; break; }
    }
  }
  return n;
}

function countP2ReachableSpace(grid: CellState[][]): number {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  let n = 0;
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
    if (grid[r][c]!=='E') continue;
    for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
      if (dr===0&&dc===0) continue;
      const nr=r+dr,nc=c+dc;
      if (nr>=0&&nr<rows&&nc>=0&&nc<cols&&(grid[nr][nc]==='p2'||grid[nr][nc]==='p2_sp')) { n++; break; }
    }
  }
  return n;
}

function countP1Overwrites(grid: CellState[][], card: Card, x: number, y: number, rotation: Rotation): number {
  if (!card.shape) return 0;
  const shape = rotateShape(card.shape, rotation);
  let n = 0;
  for (let r=0;r<shape.length;r++) for (let c=0;c<(shape[r]?.length??0);c++) {
    if (!shape[r][c]) continue;
    const gr=y+r,gc=x+c;
    if (gr>=0&&gr<grid.length&&gc>=0&&gc<(grid[0]?.length??0)&&grid[gr][gc]==='p1') n++;
  }
  return n;
}

// ─── 境界線ヘルパー ──────────────────────────────────────────────────────────

function frontierNorm(r: number, si: StageInfo): number {
  const total = Math.abs(si.p2StartRow - si.p1StartRow);
  if (total === 0) return 0.5;
  const f = si.p2StartRow > si.p1StartRow ? si.p2StartRow - r : r - si.p2StartRow;
  return Math.min(1, Math.max(0, f / total));
}

function isP2Side(r: number, si: StageInfo): boolean {
  const mid = (si.p1StartRow + si.p2StartRow) / 2;
  return si.p2StartRow > si.p1StartRow ? r >= mid : r <= mid;
}

// ─── ターン別の P1 脅威評価 ──────────────────────────────────────────────────

/** P1セルの中でP2スタートマスに最も近いチェビシェフ距離を返す */
function p1MinChebyshevFromP2Start(grid: CellState[][], si: StageInfo): number {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  let minDist = Infinity;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] === 'p1' || grid[r][c] === 'p1_sp') {
        const rowDist = Math.abs(r - si.p2StartRow);
        const colDist = Math.abs(c - si.p2StartCol);
        minDist = Math.min(minDist, Math.max(rowDist, colDist));
      }
  return isFinite(minDist) ? minDist : 999;
}

/** P1に隣接している壁/障害物マスに近い空きマスへの配置ボーナス（防衛ラインを塞ぐ） */
function countAdjToBlockedNearP1(newGrid: CellState[][]): number {
  const rows = newGrid.length, cols = newGrid[0]?.length ?? 0;
  let bonus = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (newGrid[r][c] !== 'p2' && newGrid[r][c] !== 'p2_sp') continue;
      // P2の新規セルが W/B/blocked に隣接しているかつ P1 に隣接している
      let adjWall = false, adjP1 = false;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr===0&&dc===0) continue;
        const nr=r+dr,nc=c+dc;
        if (nr<0||nr>=rows||nc<0||nc>=cols) continue;
        const cell = newGrid[nr][nc];
        if (cell==='W'||cell==='B'||cell==='blocked') adjWall = true;
        if (cell==='p1'||cell==='p1_sp') adjP1 = true;
      }
      if (adjWall && adjP1) bonus += 3;
      else if (adjWall) bonus += 1;
    }
  }
  return bonus;
}

// ─── SP発火評価ヘルパー ──────────────────────────────────────────────────────

/** P2 SPマスが今回の配置で新たに発火（周囲8マスが全て非空）した数を返す */
function countNewlyFiredSP(prevGrid: CellState[][], newGrid: CellState[][]): number {
  const rows = newGrid.length, cols = newGrid[0]?.length ?? 0;
  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (newGrid[r][c] !== 'p2_sp') continue;
      // 配置前は未発火、配置後に発火した → 新規発火
      const wasFired = (() => {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r+dr, nc = c+dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && prevGrid[nr][nc] === 'E') return false;
        }
        return true;
      })();
      if (wasFired) continue;
      let nowFired = true;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r+dr, nc = c+dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && newGrid[nr][nc] === 'E') { nowFired = false; break; }
      }
      if (nowFired) count++;
    }
  }
  return count;
}

/**
 * 残り手札で次ターン以降にSPを発火できそうか評価するスコア。
 * 発火まで残り空きマス数と残り手札サイズで近似判定。
 */
function scoreSpFirePotential(
  newGrid: CellState[][],
  remainingHand: string[],
  cardMap: Map<string, Card>
): number {
  if (remainingHand.length === 0) return 0;
  const rows = newGrid.length, cols = newGrid[0]?.length ?? 0;
  // 残り手札で埋めることができる合計マス数（近似）
  const maxHandCoverage = remainingHand.reduce((sum, id) => sum + (cardMap.get(id)?.size ?? 0), 0);

  let score = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (newGrid[r][c] !== 'p2_sp') continue;
      let emptyCount = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r+dr, nc = c+dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && newGrid[nr][nc] === 'E') emptyCount++;
      }
      if (emptyCount === 0) continue; // 発火済み（countNewlyFiredSPで計上）
      if (emptyCount > maxHandCoverage) continue; // 手札で埋められない（近似）
      // 残り空きマスが少ないほど高スコア（次ターン発火に近い）
      if (emptyCount === 1) score += 6;
      else if (emptyCount === 2) score += 3;
      else if (emptyCount === 3) score += 1;
    }
  }
  return score;
}

/**
 * 配置後のP2陣地から一定範囲内の空きマス数（配置の柔軟性プロキシ）
 * 多いほど次ターンの選択肢が多い
 */
function scoreAdjacentFlexibility(newGrid: CellState[][]): number {
  const rows = newGrid.length, cols = newGrid[0]?.length ?? 0;
  const reachable = new Set<string>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (newGrid[r][c] !== 'p2' && newGrid[r][c] !== 'p2_sp') continue;
      for (let dr = -4; dr <= 4; dr++) {
        for (let dc = -4; dc <= 4; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && newGrid[nr][nc] === 'E')
            reachable.add(`${nr},${nc}`);
        }
      }
    }
  }
  return reachable.size;
}

/** Lv2ターン1〜4：中央ライン寄りの配置にボーナス（壁シード評価） */
function scoreCenterBias(grid: CellState[][], newGrid: CellState[][], si: StageInfo): number {
  const rows = newGrid.length, cols = newGrid[0]?.length ?? 0;
  const midRow = (si.p1StartRow + si.p2StartRow) / 2;
  let bonus = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const was = grid[r][c], now = newGrid[r][c];
    if ((now === 'p2' || now === 'p2_sp') && (was !== 'p2' && was !== 'p2_sp')) {
      const dist = Math.abs(r - midRow);
      bonus += Math.max(0, 5 - dist);
    }
  }
  return bonus;
}

/** 序盤（T1-4）に自分のSPマスを敵陣側に置くペナルティ */
function scoreSPExposurePenalty(
  grid: CellState[][], newGrid: CellState[][],
  si: StageInfo | undefined,
  currentTurn: number
): number {
  if (!si || currentTurn > 4) return 0;
  const rows = newGrid.length, cols = newGrid[0]?.length ?? 0;
  let penalty = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (newGrid[r][c] !== 'p2_sp') continue;
      if (grid[r]?.[c] === 'p2_sp') continue; // 以前から存在するSPマスはスキップ
      // frontierNorm: 0=P2陣営, 1=P1陣営
      const fn = frontierNorm(r, si);
      if (fn > 0.6) penalty += 5;      // 完全に敵陣側
      else if (fn > 0.5) penalty += 2; // 中央より敵陣寄り
    }
  }
  return penalty;
}

// ─── 通常配置スコア（フェーズ別戦略） ────────────────────────────────────────

function scoreNormalMove(
  grid: CellState[][], card: Card,
  x: number, y: number, rotation: Rotation,
  level: CpuLevel, remainingTurns: number,
  si: StageInfo | undefined,
  remainingHand?: string[],
  cardMap?: Map<string, Card>,
  dangerInfo?: DangerInfo
): number {
  const newGrid = simulateGrid(grid, card, x, y, rotation, 'p2');
  const rows = newGrid.length, cols = newGrid[0]?.length ?? 0;

  let newCells=0, adjToP1=0, newSP=0, p1SPKilled=0, continuity=0;
  let frontierMax=0, p2HalfCells=0, p1AdjSP=0, wallDensity=0;

  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
    const was=grid[r]?.[c], now=newGrid[r]?.[c];
    const isNew = (now==='p2'||now==='p2_sp')&&(was!=='p2'&&was!=='p2_sp');
    if (!isNew) continue;
    newCells++;
    if (now==='p2_sp') newSP++;
    if (was==='p1_sp') p1SPKilled++;
    for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr=r+dr,nc=c+dc;
      if (nr>=0&&nr<rows&&nc>=0&&nc<cols) {
        if (grid[nr][nc]==='p1'||grid[nr][nc]==='p1_sp') { adjToP1++; break; }
      }
    }
    for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr=r+dr,nc=c+dc;
      if (nr>=0&&nr<rows&&nc>=0&&nc<cols&&grid[nr][nc]==='p1_sp') { p1AdjSP++; break; }
    }
    for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr=r+dr,nc=c+dc;
      if (nr>=0&&nr<rows&&nc>=0&&nc<cols&&(grid[nr][nc]==='p2'||grid[nr][nc]==='p2_sp')) {
        continuity++; wallDensity++; break;
      }
    }
    if (si) {
      const fn = frontierNorm(r, si);
      if (fn > frontierMax) frontierMax = fn;
      if (isP2Side(r, si)) p2HalfCells++;
    }
  }

  const p1Total = countType(grid,'p1','p1_sp');
  const p2Total = countType(grid,'p2','p2_sp');
  const surrounded = countFullySurroundedSP(newGrid);
  const p1Opps  = countP1Opportunities(newGrid);
  const p2Space = countP2ReachableSpace(newGrid);

  const maxTurns = 12;
  const currentTurn = maxTurns - remainingTurns;
  const isEarly = currentTurn <= 4;
  const isMid   = currentTurn > 4 && currentTurn <= 8;

  // ── 危険地帯カバーボーナス ─────────────────────────────────────────────────
  let dangerCellsCovered = 0;
  let dangerRegionEliminated = false;
  if (dangerInfo && dangerInfo.cells.size > 0) {
    const newP2InDanger = new Set<string>();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const was = grid[r]?.[c], now = newGrid[r]?.[c];
      if ((now === 'p2' || now === 'p2_sp') && (was !== 'p2' && was !== 'p2_sp')) {
        const k = `${r},${c}`;
        if (dangerInfo.cells.has(k)) { dangerCellsCovered++; newP2InDanger.add(k); }
      }
    }
    // この配置1枚で危険地帯の連結領域が全て塞がれるか
    for (const region of dangerInfo.regions) {
      if ([...region].every(k => newP2InDanger.has(k))) { dangerRegionEliminated = true; break; }
    }
  }
  // レベル別危険地帯ボーナス（Lv2は強化：壁形成の核となるため高めに設定）
  const dangerCoverBase = level === 2 ? 45 : level === 3 ? 15 : level === 1 ? 2 : 0;
  const dangerCoverBonus = dangerCellsCovered > 0
    ? dangerCellsCovered * dangerCoverBase + (dangerRegionEliminated ? dangerCoverBase * 3 : 0)
    : 0;

  // ── SP発火評価 ─────────────────────────────────────────────────────────────
  const newlyFiredSP = countNewlyFiredSP(grid, newGrid);
  // 同時発火（2マス以上）は最優先ボーナス
  const simultaneousFireBonus = newlyFiredSP >= 2 ? 35 : newlyFiredSP === 1 ? 12 : 0;
  // 残り手札で次ターン発火できるか（手札連動評価）
  const nearFireScore = (remainingHand && cardMap)
    ? scoreSpFirePotential(newGrid, remainingHand, cardMap)
    : 0;
  // 序盤SPマス露出ペナルティ
  const spExposurePenalty = scoreSPExposurePenalty(grid, newGrid, si, currentTurn);

  // ── ターン1・2 特別ボーナス ──────────────────────────────────────────────
  // ターン1：なるべく敵陣に近い位置へ（全レベル共通、frontier最大化）
  const isTurn1 = currentTurn === 1;
  const isTurn2 = currentTurn === 2;

  // ターン2：P1の脅威レベルを判断
  let turn2DefenseMode = false;   // true = P1が近い→防衛優先
  let p1MinDist = 999;
  if (isTurn2 && si) {
    p1MinDist = p1MinChebyshevFromP2Start(grid, si);
    // チェビシェフ距離6以内 or 縦横距離7以内 → 防衛モード
    const rowDist = countType(grid,'p1','p1_sp') > 0
      ? (() => {
          let minRow = Infinity;
          for (let r=0; r<rows; r++) for (let c=0; c<cols; c++)
            if (grid[r][c]==='p1'||grid[r][c]==='p1_sp')
              minRow = Math.min(minRow, Math.abs(r - si.p2StartRow));
          return isFinite(minRow) ? minRow : 999;
        })()
      : 999;
    turn2DefenseMode = p1MinDist <= 6 || rowDist <= 7;
  }

  const adjToBlockedNearP1Bonus = (isTurn2 && turn2DefenseMode)
    ? countAdjToBlockedNearP1(newGrid) : 0;

  // 壁形成ボーナス：配置前は壁なし → 配置後に壁あり
  const hadWall = checkWallFormation(grid);
  const hasWall = hadWall || checkWallFormation(newGrid);
  const wallBonus = !hadWall && hasWall;

  // P2自陣への P1侵入数
  const p1InP2Half = si ? (() => {
    let n=0;
    for (let r=0;r<rows;r++) if (isP2Side(r,si))
      for (let c=0;c<cols;c++) if (grid[r][c]==='p1'||grid[r][c]==='p1_sp') n++;
    return n;
  })() : 0;

  // 壁ボーナス値（レベル別）
  const wallBonusVal = wallBonus
    ? (level===2 ? 25 : level===3 ? 15 : level===4 ? 12 : 4) * (p1InP2Half > 0 ? 1.5 : 1)
    : 0;

  // 既存壁がある場合の内部壁形成ボーナス（P1侵入を封じる）
  const innerWallVal = hadWall && p1InP2Half > 0 && hasWall ? 10 : 0;

  // ── ターン1共通：敵陣最深部を目指す追加ボーナス ─────────────────────────
  const turn1FrontierBonus = isTurn1 && si ? frontierMax * 10 : 0;

  // ── ターン2共通：P1の脅威に応じた対応ボーナス ────────────────────────────
  const turn2Bonus = isTurn2
    ? turn2DefenseMode
      ? adjToBlockedNearP1Bonus * 2 + wallBonusVal * 1.5  // 防衛モード
      : (si ? frontierMax * 8 : 0)                         // 攻撃継続（P1が遠い）
    : 0;

  switch (level) {
    // ── Lv1：アグロ ──────────────────────────────────────────────────────────
    case 1: {
      const aggrFactor = isEarly ? 2.0 : isMid ? 1.5 : 1.0;
      const attack = (adjToP1 * 4 + (si ? frontierMax * 6 : 0) + p1AdjSP * 3) * aggrFactor;
      const fill   = isMid ? newCells * 1.0 : 0;
      return attack + fill + p2Space * 1 + continuity * 0.3 + wallBonusVal * 0.5
        + simultaneousFireBonus * 0.5 + nearFireScore * 0.3 + dangerCoverBonus
        + turn1FrontierBonus + turn2Bonus;
    }

    // ── Lv2：コントロール ─────────────────────────────────────────────────────
    case 2: {
      const flexScore = scoreAdjacentFlexibility(newGrid);
      if (isTurn1) {
        // ターン1：中央ライン寄りの壁シード位置を優先、SP露出回避
        const centerBias = si ? scoreCenterBias(grid, newGrid, si) : 0;
        const def = si ? p2HalfCells * 3 + wallDensity * 2 : continuity * 2;
        return newCells * 2 + def + p2Space * 1 + centerBias * 2.5
          + dangerCoverBonus + flexScore * 0.3 - spExposurePenalty;
      } else if (isTurn2) {
        // ターン2：防衛か壁形成かを切り替え
        if (turn2DefenseMode) {
          const def = si ? p2HalfCells * 3 + wallDensity * 2 : continuity * 2;
          return simultaneousFireBonus * 1.2 + nearFireScore * 0.8
            + surrounded * 8 + newSP * 4 + def + p2Space * 1
            + dangerCoverBonus + turn2Bonus + wallBonusVal + flexScore * 0.3 - spExposurePenalty;
        } else {
          // 非防衛：攻撃継続ではなく壁形成を優先
          const centerBias = si ? scoreCenterBias(grid, newGrid, si) : 0;
          const def = si ? p2HalfCells * 3 + wallDensity * 3 : continuity * 3;
          return simultaneousFireBonus * 1.2 + nearFireScore * 0.8
            + surrounded * 8 + newSP * 4 + def + p2Space * 1 + centerBias * 2.0
            + dangerCoverBonus + wallBonusVal + flexScore * 0.3 - spExposurePenalty;
        }
      } else if (isEarly) {
        // 序盤（T3-4）：壁形成＋危険地帯封鎖＋SP発火準備＋露出回避
        const def = si ? p2HalfCells * 3 + wallDensity * 2 : continuity * 2;
        const risk = si ? frontierMax * -6 : 0;
        return simultaneousFireBonus * 1.5 + nearFireScore * 1.2
          + surrounded * 8 + newSP * 4 + def + p2Space * 1
          + dangerCoverBonus + risk + wallBonusVal + flexScore * 0.3 - spExposurePenalty;
      } else if (isMid) {
        // 中盤：発火最優先＋危険地帯封鎖
        const fillEfficiency = newCells * 2.5 + p2HalfCells * 2 + wallDensity * 1.5;
        return simultaneousFireBonus * 2.0 + nearFireScore * 1.5
          + surrounded * 10 + newSP * 5 + fillEfficiency + p2Space * 1
          + dangerCoverBonus + wallBonusVal + innerWallVal + flexScore * 0.2;
      } else {
        // 終盤：発火＋占領
        return simultaneousFireBonus * 2.0 + nearFireScore * 1.0
          + surrounded * 12 + newSP * 6 + newCells * 1.0 + p2Space * 1
          + dangerCoverBonus;
      }
    }

    // ── Lv3：バランス ─────────────────────────────────────────────────────────
    case 3: {
      const frontierB = si ? frontierMax * 4 : 0;
      const agg = adjToP1 * 3 + newCells * 1.5 + continuity * 0.5 + frontierB;
      const ctl = surrounded * 10 + newSP * 5 + newCells * 0.5 + (si ? p2HalfCells * 1.5 : 0);
      const fillB = isMid ? (newCells * 1.5 + wallDensity * 1.0) : 0;
      const aw = p1Total > p2Total ? 0.65 : p2Total > p1Total ? 0.35 : 0.5;
      return (aw * agg + (1-aw) * ctl) * 2 + p2Space * 2 - p1Opps * 0.3 + fillB + wallBonusVal
        + simultaneousFireBonus * 1.2 + nearFireScore * 0.8 + dangerCoverBonus
        + turn1FrontierBonus * 0.7 + turn2Bonus * 0.8 - spExposurePenalty * 0.5;
    }

    // ── Lv4：先読み ───────────────────────────────────────────────────────────
    case 4: {
      const routeBlock  = p1AdjSP * 4;
      const fillB       = isMid ? (newCells * 1.5 + wallDensity * 1.0) : 0;
      const base        = adjToP1 * 2 + newCells * 2 + newSP * 5 + p1SPKilled * 6
                          + routeBlock - p1Opps * 1.5;
      return base + p2Space * 3 + fillB + wallBonusVal + innerWallVal
        + simultaneousFireBonus * 2.5 + nearFireScore * 2.0
        + turn1FrontierBonus * 0.6 + turn2Bonus * 0.9 - spExposurePenalty;
    }
  }
}

// ─── SA配置スコア ─────────────────────────────────────────────────────────────

function scoreSAMove(
  grid: CellState[][], card: Card,
  x: number, y: number, rotation: Rotation,
  level: CpuLevel,
  isFinalTurn: boolean
): number {
  const newGrid  = simulateGrid(grid, card, x, y, rotation, 'p2');
  const overwrites = countP1Overwrites(grid, card, x, y, rotation);
  const rows = newGrid.length, cols = newGrid[0]?.length ?? 0;
  let newCells = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const was = grid[r]?.[c], now = newGrid[r]?.[c];
    if ((now === 'p2' || now === 'p2_sp') && (was !== 'p2' && was !== 'p2_sp')) newCells++;
  }

  // 最終ターン：獲得マス数 + 奪取マス数のみで評価
  if (isFinalTurn) {
    return newCells + overwrites * 2;
  }

  // SA後に新たに発火するP2 SPマス数
  const newlyFiredSP = countNewlyFiredSP(grid, newGrid);

  // カード自身のSPマスがSA配置で同時発火するか（実質消費SP-1相当）
  let cardSPFired = false;
  if (card.specialPos && card.shape) {
    const origRows = card.shape.length, origCols = card.shape[0]?.length ?? 0;
    const [sr, sc] = card.specialPos;
    let rr: number, rc: number;
    switch (rotation) {
      case 90:  rr = sc; rc = origRows - 1 - sr; break;
      case 180: rr = origRows - 1 - sr; rc = origCols - 1 - sc; break;
      case 270: rr = origCols - 1 - sc; rc = sr; break;
      default:  rr = sr; rc = sc;
    }
    const gr = y + rr, gc = x + rc;
    if (gr >= 0 && gr < rows && gc >= 0 && gc < cols && newGrid[gr][gc] === 'p2_sp') {
      let fired = true;
      for (let dr = -1; dr <= 1 && fired; dr++) for (let dc = -1; dc <= 1 && fired; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = gr+dr, nc = gc+dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && newGrid[nr][nc] === 'E') fired = false;
      }
      cardSPFired = fired;
    }
  }

  // SP2個以上同時発火は高評価
  const fireBonus = newlyFiredSP >= 2 ? newlyFiredSP * 12 : newlyFiredSP * 8;
  const selfSPBonus = cardSPFired ? 10 : 0;
  const levelBonus = level === 4 ? 5 : level === 3 ? 3 : level === 2 ? 2 : 0;
  const p2Space = countP2ReachableSpace(newGrid);
  return overwrites * 5 + newCells * 2 + p2Space * 1 + fireBonus + selfSPBonus + levelBonus;
}

// ─── CPU最善手計算 ────────────────────────────────────────────────────────────

export function computeCpuMove(
  grid: CellState[][],
  hand: string[],
  cardMap: Map<string, Card>,
  level: CpuLevel,
  availableSP: number,
  remainingTurns: number,
  stageInfo?: StageInfo,
  allCards?: Card[]
): CpuMove | 'pass' {
  const maxTurns    = 12;
  const currentTurn = maxTurns - remainingTurns;
  const isLate      = currentTurn > 8;
  const isFinalTurn = currentTurn === 12;

  // 危険地帯を事前に一度だけ計算（Lv1〜3のみ、Lv4は対象外）
  const dangerInfo: DangerInfo | undefined = (level <= 3 && allCards && allCards.length > 0)
    ? computeDangerZones(grid, allCards)
    : undefined;
  // 終盤（T9-12）は全レベルでSA積極検討
  // Lv2はT5以降からSA検討開始（計画的SA）
  // 最終ターンは全レベルで必ずSA検討
  const considerSA  = isFinalTurn || isLate || (level === 2 && currentTurn > 4) || level === 4;

  let bestNormalScore = -Infinity, bestNormalMove: CpuMove | null = null;
  let bestSAScore     = -Infinity, bestSAMove:     CpuMove | null = null;

  for (const cardId of hand) {
    const card = cardMap.get(cardId);
    if (!card?.shape) continue;

    const isSWCard = !card.specialPos; // SPマスを持たないカード

    // 通常配置（全4回転×全座標）
    // このカードを使った後の残り手札（SP発火ポテンシャル評価用）
    const remainingHand = hand.filter(id => id !== cardId);
    for (const { x, y, rotation } of getAllValidPlacements(grid, card, 'p2', false)) {
      let s = scoreNormalMove(grid, card, x, y, rotation, level, remainingTurns, stageInfo, remainingHand, cardMap, dangerInfo);
      // SWカードは通常配置を抑制してSAに誘導（SA選択肢がある場合のみ意味を持つ）
      if (isSWCard && considerSA && card.spp > 0 && availableSP >= card.spp) s -= 6;
      if (s > bestNormalScore || (s === bestNormalScore && Math.random() < 0.15)) {
        bestNormalScore = s;
        bestNormalMove  = { cardId, x, y, rotation, isSA: false, cardName: card.name };
      }
    }

    // SA配置
    if (considerSA && card.spp > 0 && availableSP >= card.spp) {
      for (const { x, y, rotation } of getAllValidPlacements(grid, card, 'p2', true)) {
        let s = scoreSAMove(grid, card, x, y, rotation, level, isFinalTurn);
        // SWカードのSA優先ボーナス（SPマスを持たないためSA使用が最も効率的）
        if (isSWCard) s += 8;
        if (s > bestSAScore) {
          bestSAScore = s;
          bestSAMove  = { cardId, x, y, rotation, isSA: true, cardName: card.name };
        }
      }
    }
  }

  if (bestNormalMove === null) return bestSAMove ?? 'pass';

  // SA優先閾値
  if (bestSAMove !== null) {
    if (isFinalTurn) {
      // 最終ターン：SPが使えるなら積極的にSA（スコア0超なら常に選択）
      if (bestSAScore > 0) return bestSAMove;
    } else if (isLate) {
      // 終盤（T9-11）：全レベルで積極SA
      const threshold = level === 1 ? 12 : level === 2 ? -2 : level === 3 ? 2 : -3;
      if (bestSAScore >= bestNormalScore + threshold) return bestSAMove;
    } else if (level === 2 && currentTurn > 4) {
      // Lv2中盤：発火準備を優先。SA使用は通常より大きく有利な場合のみ
      if (bestSAScore >= bestNormalScore + 15) return bestSAMove;
    }
  }

  return bestNormalMove;
}

/** CPUパス時：手持ちの最も不要なカードIDを返す（hand が空の場合 null） */
export function pickCardToTrash(hand: string[], cardMap: Map<string, Card>): string | null {
  if (hand.length === 0) return null;
  // サイズが最小のカードを捨てる（最も盤面貢献が低い）
  let minSize = Infinity, minId = hand[0];
  for (const id of hand) {
    const s = cardMap.get(id)?.size ?? 999;
    if (s < minSize) { minSize = s; minId = id; }
  }
  return minId;
}
