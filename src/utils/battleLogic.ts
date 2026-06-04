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
    if (rRows > rows || rCols > cols) continue;
    for (let y = 0; y <= rows - rRows; y++)
      for (let x = 0; x <= cols - rCols; x++)
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

// ─── 通常配置スコア（フェーズ別戦略） ────────────────────────────────────────

function scoreNormalMove(
  grid: CellState[][], card: Card,
  x: number, y: number, rotation: Rotation,
  level: CpuLevel, remainingTurns: number,
  si: StageInfo | undefined
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
        + turn1FrontierBonus + turn2Bonus;
    }

    // ── Lv2：コントロール ─────────────────────────────────────────────────────
    case 2: {
      if (isTurn1) {
        // ターン1：敵陣に踏み出しつつも自陣展開（Lv2らしくフロンティア低め）
        const def = si ? p2HalfCells * 2 + wallDensity * 1 : continuity * 1;
        return newCells * 2 + def + p2Space * 1 + turn1FrontierBonus * 0.4;
      } else if (isTurn2) {
        // ターン2：防衛か継続かを切り替え
        if (turn2DefenseMode) {
          const def = si ? p2HalfCells * 3 + wallDensity * 2 : continuity * 2;
          return surrounded * 8 + newSP * 4 + def + p2Space * 1 + turn2Bonus + wallBonusVal;
        } else {
          const def = si ? p2HalfCells * 2 + wallDensity * 1 : continuity * 1;
          return surrounded * 8 + newSP * 4 + def + p2Space * 1 + turn2Bonus;
        }
      } else if (isEarly) {
        const def = si ? p2HalfCells * 3 + wallDensity * 2 : continuity * 2;
        const risk = si ? frontierMax * -6 : 0;
        return surrounded * 8 + newSP * 4 + def + p2Space * 1 + risk + wallBonusVal;
      } else if (isMid) {
        const fillEfficiency = newCells * 2.5 + p2HalfCells * 2 + wallDensity * 1.5;
        return surrounded * 10 + newSP * 5 + fillEfficiency + p2Space * 1 + wallBonusVal + innerWallVal;
      } else {
        return surrounded * 12 + newSP * 6 + newCells * 1.0 + p2Space * 1;
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
        + turn1FrontierBonus * 0.7 + turn2Bonus * 0.8;
    }

    // ── Lv4：先読み ───────────────────────────────────────────────────────────
    case 4: {
      const routeBlock  = p1AdjSP * 4;
      const fillB       = isMid ? (newCells * 1.5 + wallDensity * 1.0) : 0;
      const base        = adjToP1 * 2 + newCells * 2 + newSP * 5 + p1SPKilled * 6
                          + routeBlock - p1Opps * 1.5;
      return base + p2Space * 3 + fillB + wallBonusVal + innerWallVal
        + turn1FrontierBonus * 0.6 + turn2Bonus * 0.9;
    }
  }
}

// ─── SA配置スコア ─────────────────────────────────────────────────────────────

function scoreSAMove(
  grid: CellState[][], card: Card,
  x: number, y: number, rotation: Rotation,
  level: CpuLevel
): number {
  const newGrid  = simulateGrid(grid, card, x, y, rotation, 'p2');
  const overwrites = countP1Overwrites(grid, card, x, y, rotation);
  const p2Space  = countP2ReachableSpace(newGrid);
  let newCells   = 0;
  const rows=newGrid.length,cols=newGrid[0]?.length??0;
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
    const was=grid[r]?.[c],now=newGrid[r]?.[c];
    if ((now==='p2'||now==='p2_sp')&&(was!=='p2'&&was!=='p2_sp')) newCells++;
  }
  const levelBonus = level===4 ? 5 : level===3 ? 3 : level===2 ? 2 : 0;
  return overwrites * 5 + newCells * 2 + p2Space * 1 + levelBonus;
}

// ─── CPU最善手計算 ────────────────────────────────────────────────────────────

export function computeCpuMove(
  grid: CellState[][],
  hand: string[],
  cardMap: Map<string, Card>,
  level: CpuLevel,
  availableSP: number,
  remainingTurns: number,
  stageInfo?: StageInfo
): CpuMove | 'pass' {
  const maxTurns    = 12;
  const currentTurn = maxTurns - remainingTurns;
  const isLate      = currentTurn > 8;
  // 終盤（T9-12）は全レベルでSA積極検討
  // Lv2はT5以降からSA検討開始（計画的SA）
  const considerSA  = (isLate) || (level === 2 && currentTurn > 4) || level === 4;

  let bestNormalScore = -Infinity, bestNormalMove: CpuMove | null = null;
  let bestSAScore     = -Infinity, bestSAMove:     CpuMove | null = null;

  for (const cardId of hand) {
    const card = cardMap.get(cardId);
    if (!card?.shape) continue;

    // 通常配置（全4回転×全座標）
    for (const { x, y, rotation } of getAllValidPlacements(grid, card, 'p2', false)) {
      const s = scoreNormalMove(grid, card, x, y, rotation, level, remainingTurns, stageInfo);
      if (s > bestNormalScore || (s === bestNormalScore && Math.random() < 0.15)) {
        bestNormalScore = s;
        bestNormalMove  = { cardId, x, y, rotation, isSA: false, cardName: card.name };
      }
    }

    // SA配置
    if (considerSA && card.spp > 0 && availableSP >= card.spp) {
      for (const { x, y, rotation } of getAllValidPlacements(grid, card, 'p2', true)) {
        const s = scoreSAMove(grid, card, x, y, rotation, level);
        if (s > bestSAScore) {
          bestSAScore = s;
          bestSAMove  = { cardId, x, y, rotation, isSA: true, cardName: card.name };
        }
      }
    }
  }

  if (bestNormalMove === null) return bestSAMove ?? 'pass';

  // 終盤SA優先閾値：全レベルで SA を積極利用
  // Lv2は閾値ゼロ（SA ≥ Normal なら使う）、Lv1は慎重（大幅に良い場合のみ）
  if (bestSAMove !== null && isLate) {
    const threshold = level === 1 ? 12 : level === 2 ? -2 : level === 3 ? 2 : -3;
    if (bestSAScore >= bestNormalScore + threshold) return bestSAMove;
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
