import { useState, useEffect, useRef, useMemo } from 'react';
import { useStore, isSampleDeck } from '../../store';
import type { CellState, Deck, CpuLevel } from '../../types';
import { CardShape } from '../common/CardShape';
import stagesData from '../../data/stages.json';
import type { Stage } from '../../types';
import { rotateShape } from '../../utils/cardShape';
import {
  canPlace, placeCard, resolveSimultaneous,
  shuffleDeck, countCells, getActivatedSPPositions, hasAnyValidPlacement,
} from '../../utils/boardLogic';
import { computeCpuMove, pickCardToTrash } from '../../utils/battleLogic';
import type { Rotation, StageInfo } from '../../utils/battleLogic';
import { useIsLandscape } from '../../hooks/useIsLandscape';

const STAGES = stagesData as Stage[];

// ─── 定数 ─────────────────────────────────────────────────────────────────────
const MAX_TURNS  = 12;
const HAND_SIZE  = 4;
const CPU_DELAY  = 800;

const tap: React.CSSProperties = { touchAction: 'manipulation', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' };

// ─── 対戦状態の永続化 ─────────────────────────────────────────────────────────
const BATTLE_SAVE_KEY = 'nawabattler_battle_v1';

// ─── セルの色（試し置きモードと統一） ─────────────────────────────────────────
const CELL_COLOR: Record<CellState, string> = {
  E: '#1a3a1a', W: '#333333', B: '#555555', blocked: '#999999',
  p1: '#FFE000', p1_sp: '#FF4500', p2: '#0044FF', p2_sp: '#00CCFF',
};

// ─── 型 ───────────────────────────────────────────────────────────────────────
interface PendingPlacement {
  cardId: string; x: number; y: number;
  pivotX: number; pivotY: number;
  rotation: Rotation; isSA: boolean; player: 'p1' | 'p2';
  isValid: boolean;  // canPlace()の結果。falseでも仮置きは表示する
}

type AnimPhase = 'idle' | 'reveal' | 'p1-place' | 'resolve' | 'sp-fire' | 'score' | 'draw';
interface AnimData {
  p1CardId: string | null; p1isSA: boolean;
  p2CardId: string | null; p2isSA: boolean;
  p1OnlyGrid: CellState[][] | null; // P1だけ配置した中間グリッド
  p2OnlyGrid: CellState[][] | null; // P2だけ配置した中間グリッド
  p1GoesFirst: boolean;             // true=P1先表示（P1マス数≥P2）, false=P2先表示
  finalGrid: CellState[][];
  hasConflict: boolean;
  prevCounts: { p1: number; p2: number };
  finalCounts: { p1: number; p2: number };
  finalP2Hand: string[];
  finalP2Pile: string[];
  p2Drew: boolean;
  turnSnapshot: number;
  newlyFiredCount: number; // このターンで新たに発火したSPマス数
}

// ─── 2段階デッキ選択（BoardSimと同じUI） ─────────────────────────────────────
function getShapeBoundsSimple(shape: boolean[][]) {
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < (shape[r]?.length ?? 0); c++)
      if (shape[r][c]) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
  return { minR: isFinite(minR) ? minR : 0, maxR: isFinite(maxR) ? maxR : 0, minC: isFinite(minC) ? minC : 0, maxC: isFinite(maxC) ? maxC : 0 };
}

// ─── 本体 ────────────────────────────────────────────────────────────────────
export function BattleSim() {
  const { cards, decks, folders } = useStore();
  const isLandscape = useIsLandscape();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null);
  // 活性化済みSPマス位置の追跡（同じマスを二重カウントしないため）
  const p1SPCounted = useRef<Set<string>>(new Set());
  const p2SPCounted = useRef<Set<string>>(new Set());

  // ── 設定 ──────────────────────────────────────────────────────────────────
  const [screen, setScreen] = useState<'setup' | 'battle' | 'result'>('setup');
  const [stageId,   setStageId]   = useState(STAGES[0].id);
  const [cpuMode,   setCpuMode]   = useState(true);
  const [cpuLevel,  setCpuLevel]  = useState<CpuLevel>(2);
  const [p1Group,   setP1Group]   = useState('');
  const [p1DeckId,  setP1DeckId]  = useState<string | null>(null);
  const [p2Group,   setP2Group]   = useState('');
  const [p2DeckId,  setP2DeckId]  = useState<string | null>(null);

  // ── ゲーム状態 ────────────────────────────────────────────────────────────
  const [grid,      setGrid]      = useState<CellState[][]>([]);
  const [p1Pile,    setP1Pile]    = useState<string[]>([]);
  const [p2Pile,    setP2Pile]    = useState<string[]>([]);
  const [p1Hand,    setP1Hand]    = useState<string[]>([]);
  const [p2Hand,    setP2Hand]    = useState<string[]>([]);
  const [turn,      setTurn]      = useState(1);
  // 'p1' = P1の入力待ち, 'p2' = P2/CPU待ち（P1確定済み）
  const [waitFor,   setWaitFor]   = useState<'p1' | 'p2'>('p1');
  const [p1Action,  setP1Action]  = useState<{ cardId: string; x: number; y: number; rotation: Rotation; isSA: boolean } | 'pass' | null>(null);
  const [cpuThinking,  setCpuThinking]  = useState(false);
  const [cpuMessage,   setCpuMessage]   = useState<string | null>(null);
  // パス時のカードトラッシュ選択モード
  const [trashMode,    setTrashMode]    = useState<'p1' | 'p2' | null>(null);
  // localStorage復元中フラグ（復元中の保存を防ぐ）
  const isRestoringRef = useRef(false);

  // SP管理（蓄積 − 消費）
  const [p1SPAccum, setP1SPAccum] = useState(0);
  const [p2SPAccum, setP2SPAccum] = useState(0);
  const [p1SPSpent, setP1SPSpent] = useState(0);
  const [p2SPSpent, setP2SPSpent] = useState(0);

  // 統計
  const [p1SACount, setP1SACount] = useState(0);
  const [p2SACount, setP2SACount] = useState(0);

  // ターン1リシャッフル
  const [reshuffled, setReshuffled] = useState(false);

  // 途中終了確認ダイアログ
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // 配置済みカード履歴（ターン毎に蓄積）
  const [p1Placed, setP1Placed] = useState<Array<{cardId: string; isSA: boolean}>>([]);
  const [p2Placed, setP2Placed] = useState<Array<{cardId: string; isSA: boolean}>>([]);
  // 残りデッキ表示切り替え
  const [showP1Pile, setShowP1Pile] = useState(false);
  const [showP2Pile, setShowP2Pile] = useState(false);

  // ── UI状態 ────────────────────────────────────────────────────────────────
  const [p1Sel,     setP1Sel]     = useState<string | null>(null);
  const [p2Sel,     setP2Sel]     = useState<string | null>(null);
  const [p1Rot,     setP1Rot]     = useState<Rotation>(0);
  const [p2Rot,     setP2Rot]     = useState<Rotation>(0);
  const [p1SAMode,  setP1SAMode]  = useState(false);
  const [p2SAMode,  setP2SAMode]  = useState(false);
  const [pending,   setPending]   = useState<PendingPlacement | null>(null);
  const [hover,     setHover]     = useState<{ x: number; y: number } | null>(null);
  const [cellSize,     setCellSize]     = useState(10);
  const [handCellSize, setHandCellSize] = useState(3);

  // フルデッキ（ドロー順を隠すために全15枚を保持）
  const [p1FullDeck, setP1FullDeck] = useState<string[]>([]);
  const [p2FullDeck, setP2FullDeck] = useState<string[]>([]);
  // P1・P2 それぞれ独立したドロー枚数カウント（山札から手札に引いた枚数）
  const [p1DrawnCount, setP1DrawnCount] = useState(0);
  const [p2DrawnCount, setP2DrawnCount] = useState(0);

  // ゲーム終了後の遅延遷移
  const [gameEndPending, setGameEndPending] = useState(false);

  // ── 配置演出 ──────────────────────────────────────────────────────────────
  const [animEnabled, setAnimEnabled] = useState(true);
  const [animPhase, setAnimPhase] = useState<AnimPhase>('idle');
  const [animData, setAnimData] = useState<AnimData | null>(null);
  const [animDisplayGrid, setAnimDisplayGrid] = useState<CellState[][] | null>(null);
  const [animScore, setAnimScore] = useState({ p1: 0, p2: 0 });
  const [animSpFlash, setAnimSpFlash] = useState(false);

  // ── 派生値 ────────────────────────────────────────────────────────────────
  const cardMap = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards]);
  const stage = useMemo(() => STAGES.find(s => s.id === stageId) ?? STAGES[0], [stageId]);

  const counts  = useMemo(() => countCells(grid), [grid]);
  const availP1SP = p1SPAccum - p1SPSpent;
  const availP2SP = p2SPAccum - p2SPSpent;

  // 仮配置時のスコア予測（両プレイヤー）
  const pendingCounts = useMemo(() => {
    if (!pending?.isValid) return null;
    const card = cardMap.get(pending.cardId);
    if (!card?.shape) return null;
    const simGrid = placeCard(grid, card.shape, pending.x, pending.y, pending.player,
      card.specialPos, pending.rotation, pending.isSA);
    return countCells(simGrid);
  }, [pending, grid, cardMap]);

  const stageInfo = useMemo<StageInfo | undefined>(() => {
    if (!stage.p1Start || !stage.p2Start) return undefined;
    return {
      p1StartRow: stage.p1Start[1],
      p2StartRow: stage.p2Start[1],
      p1StartCol: stage.p1Start[0],
      p2StartCol: stage.p2Start[0],
      rows: stage.height,
      cols: stage.width,
    };
  }, [stage]);

  // cards登録順のインデックスマップ（ドロー順を隠すため表示ソートに使用）
  const cardOrderMap = useMemo(() => new Map(cards.map((c, i) => [c.id, i])), [cards]);

  // デッキ全15枚をcards登録順で表示（ドロー順を隠す）
  const p1DeckDisplay = useMemo(() => {
    if (!p1FullDeck.length) return [];
    return p1FullDeck
      .map((id, i) => ({ id, drawn: i < p1DrawnCount }))
      .sort((a, b) => (cardOrderMap.get(a.id) ?? 0) - (cardOrderMap.get(b.id) ?? 0));
  }, [p1FullDeck, p1DrawnCount, cardOrderMap]);

  const p2DeckDisplay = useMemo(() => {
    if (!p2FullDeck.length) return [];
    return p2FullDeck
      .map((id, i) => ({ id, drawn: i < p2DrawnCount }))
      .sort((a, b) => (cardOrderMap.get(a.id) ?? 0) - (cardOrderMap.get(b.id) ?? 0));
  }, [p2FullDeck, p2DrawnCount, cardOrderMap]);

  // 活性化済みSPマス（フレームオーバーレイ用）: アニメーション中はdisplayGridを使用
  const activatedSPPos = useMemo(() => {
    if (screen !== 'battle') return null;
    return getActivatedSPPositions(animDisplayGrid ?? grid);
  }, [grid, animDisplayGrid, screen]);

  // 手札の配置可能性（通常・SA）
  const p1HandPlaceability = useMemo(() => {
    if (!grid.length) return new Map<string, { canNormal: boolean; canSA: boolean }>();
    return new Map(p1Hand.map(id => {
      const card = cardMap.get(id);
      if (!card?.shape) return [id, { canNormal: false, canSA: false }];
      const canNormal = hasAnyValidPlacement(grid, card.shape, 'p1', false);
      const canSA = (card.spp ?? 0) > 0 && availP1SP >= card.spp && hasAnyValidPlacement(grid, card.shape, 'p1', true);
      return [id, { canNormal, canSA }];
    }));
  }, [p1Hand, grid, cardMap, availP1SP]);

  const p2HandPlaceability = useMemo(() => {
    if (!grid.length) return new Map<string, { canNormal: boolean; canSA: boolean }>();
    return new Map(p2Hand.map(id => {
      const card = cardMap.get(id);
      if (!card?.shape) return [id, { canNormal: false, canSA: false }];
      const canNormal = hasAnyValidPlacement(grid, card.shape, 'p2', false);
      const canSA = (card.spp ?? 0) > 0 && availP2SP >= card.spp && hasAnyValidPlacement(grid, card.shape, 'p2', true);
      return [id, { canNormal, canSA }];
    }));
  }, [p2Hand, grid, cardMap, availP2SP]);

  // フォルダ関連
  const userDecks   = useMemo(() => decks.filter(d => d.id !== 'all' && !isSampleDeck(d.id)), [decks]);
  const sampleDecks = useMemo(() => decks.filter(d => isSampleDeck(d.id)), [decks]);
  const folderMap   = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of folders) for (const id of f.deckIds) m.set(id, f.id);
    return m;
  }, [folders]);
  const rootUserDecks = useMemo(() => userDecks.filter(d => !folderMap.has(d.id)), [userDecks, folderMap]);

  function getDecksForGroup(group: string): Deck[] {
    if (group === 'root')   return rootUserDecks;
    if (group === 'sample') return sampleDecks;
    const folder = folders.find(f => f.id === group);
    if (!folder) return [];
    return folder.deckIds.map(id => userDecks.find(d => d.id === id)).filter((d): d is Deck => !!d);
  }

  // ── CPUアナウンス（手札エリア下に表示） ──────────────────────────────────
  function showCpuMsg(msg: string) {
    setCpuMessage(msg);
    setTimeout(() => setCpuMessage(null), 3000);
  }

  // ── localStorage 保存・削除 ────────────────────────────────────────────────
  function clearBattleState() {
    try { localStorage.removeItem(BATTLE_SAVE_KEY); } catch {}
  }

  // ── 対戦開始 ──────────────────────────────────────────────────────────────
  function startBattle() {
    if (!p1DeckId) return;
    if (!cpuMode && !p2DeckId) return;

    const p1Deck = decks.find(d => d.id === p1DeckId);
    const p2Deck = cpuMode
      ? (p2DeckId ? decks.find(d => d.id === p2DeckId) : decks.find(d => d.id === 'all'))
      : decks.find(d => d.id === p2DeckId);
    if (!p1Deck || !p2Deck) return;

    const p1Shuffled = shuffleDeck(p1Deck.cardIds);
    const p2Shuffled = shuffleDeck(p2Deck.cardIds);
    const initGrid   = stage.initialGrid.map(row => [...row] as CellState[]);

    // 初期SP：周囲8マスが全て埋まっているSPマスのみカウント（活性化判定）
    const initActivated = getActivatedSPPositions(initGrid);
    p1SPCounted.current = new Set(initActivated.p1.map(([r, c]) => `${r},${c}`));
    p2SPCounted.current = new Set(initActivated.p2.map(([r, c]) => `${r},${c}`));

    setGrid(initGrid);
    setP1Hand(p1Shuffled.slice(0, HAND_SIZE));
    setP1Pile(p1Shuffled.slice(HAND_SIZE));
    setP2Hand(p2Shuffled.slice(0, HAND_SIZE));
    setP2Pile(p2Shuffled.slice(HAND_SIZE));
    setTurn(1);
    setWaitFor('p1');
    setP1Action(null);
    setCpuThinking(false);
    setP1SPAccum(initActivated.p1.length);
    setP2SPAccum(initActivated.p2.length);
    setP1SPSpent(0);
    setP2SPSpent(0);
    setP1SACount(0);
    setP2SACount(0);
    setP1Sel(null); setP2Sel(null);
    setP1Rot(0); setP2Rot(0);
    setP1SAMode(false); setP2SAMode(false);
    setPending(null); setHover(null);
    setReshuffled(false);
    setShowExitConfirm(false);
    setTrashMode(null);
    setCpuMessage(null);
    setP1Placed([]);
    setP2Placed([]);
    setP1FullDeck(p1Shuffled);
    setP2FullDeck(p2Shuffled);
    setP1DrawnCount(HAND_SIZE);
    setP2DrawnCount(HAND_SIZE);
    setGameEndPending(false);
    setAnimPhase('idle'); setAnimData(null); setAnimDisplayGrid(null); setAnimSpFlash(false);
    clearBattleState();
    setScreen('battle');
  }

  // ── localStorage 保存（バトル中・結果画面のみ） ───────────────────────────
  useEffect(() => {
    if (isRestoringRef.current) return;
    if (screen !== 'battle' && screen !== 'result') return;
    const save = {
      screen, grid, p1Hand, p2Hand, p1Pile, p2Pile,
      turn, waitFor, p1Action,
      p1SPAccum, p2SPAccum, p1SPSpent, p2SPSpent,
      p1SACount, p2SACount, reshuffled, p1Placed, p2Placed,
      p1SPCounted: [...p1SPCounted.current],
      p2SPCounted: [...p2SPCounted.current],
      cpuMode, cpuLevel, stageId, p1DeckId, p2DeckId,
      p1FullDeck, p2FullDeck,
      p1DrawnCount, p2DrawnCount,
    };
    try { localStorage.setItem(BATTLE_SAVE_KEY, JSON.stringify(save)); } catch {}
  }, [screen, grid, p1Hand, p2Hand, p1Pile, p2Pile, turn, waitFor, p1Action,
      p1SPAccum, p2SPAccum, p1SPSpent, p2SPSpent, p1SACount, p2SACount,
      reshuffled, p1Placed, p2Placed, cpuMode, cpuLevel, stageId, p1DeckId, p2DeckId,
      p1DrawnCount, p2DrawnCount]);

  // ── localStorage 復元（マウント時1回） ────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem(BATTLE_SAVE_KEY);
    if (!saved) return;
    try {
      const d = JSON.parse(saved);
      if (d.screen !== 'battle' && d.screen !== 'result') return;
      isRestoringRef.current = true;
      setScreen(d.screen);
      if (d.grid)        setGrid(d.grid);
      if (d.p1Hand)      setP1Hand(d.p1Hand);
      if (d.p2Hand)      setP2Hand(d.p2Hand);
      if (d.p1Pile)      setP1Pile(d.p1Pile);
      if (d.p2Pile)      setP2Pile(d.p2Pile);
      if (d.turn)        setTurn(d.turn);
      if (d.waitFor)     setWaitFor(d.waitFor);
      setP1Action(d.p1Action ?? null);
      setP1SPAccum(d.p1SPAccum ?? 0);
      setP2SPAccum(d.p2SPAccum ?? 0);
      setP1SPSpent(d.p1SPSpent ?? 0);
      setP2SPSpent(d.p2SPSpent ?? 0);
      setP1SACount(d.p1SACount ?? 0);
      setP2SACount(d.p2SACount ?? 0);
      setReshuffled(d.reshuffled ?? false);
      setP1Placed(d.p1Placed ?? []);
      setP2Placed(d.p2Placed ?? []);
      p1SPCounted.current = new Set(d.p1SPCounted ?? []);
      p2SPCounted.current = new Set(d.p2SPCounted ?? []);
      if (d.cpuMode  !== undefined) setCpuMode(d.cpuMode);
      if (d.cpuLevel !== undefined) setCpuLevel(d.cpuLevel);
      if (d.stageId  !== undefined) setStageId(d.stageId);
      if (d.p1DeckId !== undefined) setP1DeckId(d.p1DeckId);
      if (d.p2DeckId !== undefined) setP2DeckId(d.p2DeckId);
      if (d.p1FullDeck) setP1FullDeck(d.p1FullDeck);
      if (d.p2FullDeck) setP2FullDeck(d.p2FullDeck);
      if (d.p1DrawnCount !== undefined) setP1DrawnCount(d.p1DrawnCount);
      if (d.p2DrawnCount !== undefined) setP2DrawnCount(d.p2DrawnCount);
      setCpuThinking(false); setPending(null); setHover(null);
      setP1Sel(null); setP2Sel(null); setP1SAMode(false); setP2SAMode(false);
      setShowExitConfirm(false); setTrashMode(null); setCpuMessage(null);
      setTimeout(() => { isRestoringRef.current = false; }, 0);
    } catch { isRestoringRef.current = false; }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 活性化SP更新（グリッド更新後に呼ぶ） ────────────────────────────────────
  function applyNewSP(newGrid: CellState[][]) {
    const activated = getActivatedSPPositions(newGrid);
    let newP1 = 0, newP2 = 0;
    for (const [r, c] of activated.p1) {
      const key = `${r},${c}`;
      if (!p1SPCounted.current.has(key)) { p1SPCounted.current.add(key); newP1++; }
    }
    for (const [r, c] of activated.p2) {
      const key = `${r},${c}`;
      if (!p2SPCounted.current.has(key)) { p2SPCounted.current.add(key); newP2++; }
    }
    if (newP1 > 0) setP1SPAccum(prev => prev + newP1);
    if (newP2 > 0) setP2SPAccum(prev => prev + newP2);
  }

  // ── アニメーション結果の即時適用（演出オフ時または演出完了時） ────────────
  function applyAnimResult(data: AnimData) {
    applyNewSP(data.finalGrid);
    setGrid(data.finalGrid);
    setP2Hand(data.finalP2Hand);
    setP2Pile(data.finalP2Pile);
    if (data.p2Drew) setP2DrawnCount(c => c + 1);
    setCpuThinking(false);
    advanceTurn(data.finalGrid);
  }

  // 配置の衝突（P1とP2のセルが重なる）を検出
  function detectConflict(
    p1Act: typeof p1Action,
    cpuMove: { cardId: string; x: number; y: number; rotation: Rotation } | 'pass'
  ): boolean {
    if (p1Act === 'pass' || p1Act === null || cpuMove === 'pass') return false;
    const c1 = cardMap.get(p1Act.cardId);
    const c2 = cardMap.get(cpuMove.cardId);
    if (!c1?.shape || !c2?.shape) return false;
    const s1 = rotateShape(c1.shape, p1Act.rotation);
    const s2 = rotateShape(c2.shape, cpuMove.rotation);
    const p1Cells = new Set<string>();
    for (let r = 0; r < s1.length; r++)
      for (let c = 0; c < (s1[r]?.length ?? 0); c++)
        if (s1[r][c]) p1Cells.add(`${p1Act.y+r},${p1Act.x+c}`);
    for (let r = 0; r < s2.length; r++)
      for (let c = 0; c < (s2[r]?.length ?? 0); c++)
        if (s2[r][c] && p1Cells.has(`${cpuMove.y+r},${cpuMove.x+c}`)) return true;
    return false;
  }

  // ── カードを引く（使用後に補充） ──────────────────────────────────────────
  function drawCard(
    usedCardId: string,
    hand: string[], pile: string[]
  ): { newHand: string[]; newPile: string[] } {
    const idx = hand.indexOf(usedCardId);
    const newHand = [...hand];
    if (pile.length > 0) {
      if (idx !== -1) newHand[idx] = pile[0];
      else newHand.push(pile[0]);
      return { newHand, newPile: pile.slice(1) };
    }
    if (idx !== -1) newHand.splice(idx, 1);
    return { newHand, newPile: pile };
  }

  // ── ターン1リシャッフル ───────────────────────────────────────────────────
  function handleReshuffle() {
    if (turn !== 1 || reshuffled || waitFor !== 'p1') return;
    const allCards = shuffleDeck([...p1Hand, ...p1Pile]);
    setP1Hand(allCards.slice(0, HAND_SIZE));
    setP1Pile(allCards.slice(HAND_SIZE));
    setReshuffled(true);
    setPending(null); setP1Sel(null); setP1SAMode(false);
  }

  // ── P1アクション確定 ──────────────────────────────────────────────────────
  function confirmP1Action() {
    if (!pending || !pending.isValid) return;
    const action = { cardId: pending.cardId, x: pending.x, y: pending.y, rotation: pending.rotation, isSA: pending.isSA };
    const card = cardMap.get(pending.cardId);
    if (pending.isSA && card) {
      setP1SPSpent(s => s + card.spp);
      setP1SACount(n => n + 1);
    }
    // SP加算はグリッド更新後にapplyNewSPで行う（ここでは行わない）
    setP1Placed(prev => [...prev, { cardId: pending.cardId, isSA: pending.isSA }]);
    const { newHand, newPile } = drawCard(pending.cardId, p1Hand, p1Pile);
    setP1Hand(newHand);
    setP1Pile(newPile);
    if (p1Pile.length > 0) setP1DrawnCount(c => c + 1);
    setP1Action(action);
    setP1Sel(null); setPending(null); setHover(null); setP1SAMode(false);
    setWaitFor('p2');
  }

  function handleP1Pass() {
    if (waitFor !== 'p1') return;
    if (p1Hand.length > 0) {
      // カードがある場合はトラッシュ選択画面を表示
      setTrashMode('p1');
    } else {
      // カードなし：直接パス（SP+1）
      setP1SPAccum(prev => prev + 1);
      setP1Action('pass');
      setP1Sel(null); setPending(null); setP1SAMode(false);
      setWaitFor('p2');
    }
  }

  function handleP2Pass() {
    if (waitFor !== 'p2' || cpuMode || animPhase !== 'idle') return;
    if (p2Hand.length > 0) {
      setTrashMode('p2');
    } else {
      // カードなし：直接パス（演出適用）
      setP2SPAccum(prev => prev + 1);
      let newGrid = grid;
      if (p1Action !== 'pass' && p1Action !== null) {
        const card = cardMap.get(p1Action.cardId);
        if (card?.shape) {
          newGrid = placeCard(grid, card.shape, p1Action.x, p1Action.y, 'p1',
            card.specialPos, p1Action.rotation, p1Action.isSA);
        }
      }
      setP2Sel(null); setPending(null); setP2SAMode(false);
      fireManualAnimation('pass', newGrid, p2Hand, p2Pile, false);
    }
  }

  // ── パス確定（トラッシュ完了後） ──────────────────────────────────────────
  function completeTrashPass(trashCardId: string | null) {
    const isP1 = trashMode === 'p1';
    setTrashMode(null);
    if (isP1) {
      // トラッシュ後、同スロットに山札から1枚補充
      const trashIdx = trashCardId ? p1Hand.indexOf(trashCardId) : -1;
      const afterTrash = [...p1Hand];
      let newP1Pile = p1Pile;
      if (trashIdx !== -1) {
        if (p1Pile.length > 0) { afterTrash[trashIdx] = p1Pile[0]; newP1Pile = p1Pile.slice(1); setP1DrawnCount(c => c + 1); }
        else afterTrash.splice(trashIdx, 1);
      }
      const newP1Hand = afterTrash;
      setP1Hand(newP1Hand);
      setP1Pile(newP1Pile);
      setP1SPAccum(prev => prev + 1);
      setP1Action('pass');
      setP1Sel(null); setPending(null); setP1SAMode(false);
      setWaitFor('p2');
    } else {
      // P2トラッシュパス：手札・山札更新はanimResult適用時まで遅延
      const trashIdx2 = trashCardId ? p2Hand.indexOf(trashCardId) : -1;
      const afterTrash2 = [...p2Hand];
      let newP2Pile = p2Pile;
      let p2Drew2 = false;
      if (trashIdx2 !== -1) {
        if (p2Pile.length > 0) { afterTrash2[trashIdx2] = p2Pile[0]; newP2Pile = p2Pile.slice(1); p2Drew2 = true; }
        else afterTrash2.splice(trashIdx2, 1);
      }
      setP2SPAccum(prev => prev + 1);
      let newGrid = grid;
      if (p1Action !== 'pass' && p1Action !== null) {
        const card = cardMap.get(p1Action.cardId);
        if (card?.shape) {
          newGrid = placeCard(grid, card.shape, p1Action.x, p1Action.y, 'p1',
            card.specialPos, p1Action.rotation, p1Action.isSA);
        }
      }
      setP2Sel(null); setPending(null); setP2SAMode(false);
      fireManualAnimation('pass', newGrid, afterTrash2, newP2Pile, p2Drew2);
    }
  }

  // ── CPUターン自動実行 ─────────────────────────────────────────────────────
  useEffect(() => {
    if (waitFor !== 'p2' || !cpuMode || p1Action === null) return;
    setCpuThinking(true);
    const timer = setTimeout(() => {
      const move = computeCpuMove(grid, p2Hand, cardMap, cpuLevel, availP2SP, MAX_TURNS - turn, stageInfo, cards, p1Hand, p1Pile, p1Action ?? undefined);
      let newGrid = grid;
      let p2CardId: string | null = null;
      let p2isSA = false;

      if (move !== 'pass') {
        const card = cardMap.get(move.cardId);
        if (card?.shape) {
          newGrid = resolveSimultaneous(
            grid,
            p1Action !== 'pass'
              ? { cardId: p1Action.cardId, x: p1Action.x, y: p1Action.y, rotation: p1Action.rotation, isSpecialAttack: p1Action.isSA }
              : 'pass',
            { cardId: move.cardId, x: move.x, y: move.y, rotation: move.rotation, isSpecialAttack: move.isSA },
            (id) => cardMap.get(id)?.shape ?? null,
            (id) => cardMap.get(id)?.specialPos ?? null,
            (id) => cardMap.get(id)?.size ?? 0
          );
          if (move.isSA) { setP2SPSpent(s => s + card.spp); setP2SACount(n => n + 1); }
          setP2Placed(prev => [...prev, { cardId: move.cardId, isSA: move.isSA }]);
          showCpuMsg(move.isSA
            ? `⚡ CPUがSAを使用しました！「${move.cardName}」`
            : `CPU が「${move.cardName}」を配置しました`);
          p2CardId = move.cardId;
          p2isSA = move.isSA;
        }
      } else {
        if (p1Action !== 'pass') {
          const card = cardMap.get(p1Action.cardId);
          if (card?.shape) {
            newGrid = placeCard(grid, card.shape, p1Action.x, p1Action.y, 'p1',
              card.specialPos, p1Action.rotation, p1Action.isSA);
          }
        }
        setP2SPAccum(prev => prev + 1);
        const trashId = pickCardToTrash(p2Hand, cardMap);
        showCpuMsg(trashId
          ? `CPU がパスしました（トラッシュ: ${cardMap.get(trashId)?.name ?? '?'}）`
          : 'CPU がパスしました');
      }

      let finalP2Hand: string[];
      let finalP2Pile: string[];
      let p2Drew = false;
      if (move !== 'pass') {
        const { newHand, newPile } = drawCard(move.cardId, p2Hand, p2Pile);
        finalP2Hand = newHand; finalP2Pile = newPile;
        p2Drew = p2Pile.length > 0;
      } else {
        const trashId = pickCardToTrash(p2Hand, cardMap);
        const afterTrash = trashId ? p2Hand.filter(id => id !== trashId) : [...p2Hand];
        if (afterTrash.length < HAND_SIZE && p2Pile.length > 0) {
          finalP2Hand = [...afterTrash, p2Pile[0]]; finalP2Pile = p2Pile.slice(1); p2Drew = true;
        } else { finalP2Hand = afterTrash; finalP2Pile = p2Pile; }
      }

      // 衝突時の段差表示用グリッド（P1・P2それぞれ単独配置）
      let p1OnlyGrid: CellState[][] | null = null;
      if (p1Action !== 'pass' && p1Action !== null) {
        const card = cardMap.get(p1Action.cardId);
        if (card?.shape) {
          p1OnlyGrid = placeCard(grid, card.shape, p1Action.x, p1Action.y, 'p1',
            card.specialPos, p1Action.rotation, p1Action.isSA);
        }
      }
      let p2OnlyGrid: CellState[][] | null = null;
      if (move !== 'pass') {
        const card = cardMap.get(move.cardId);
        if (card?.shape) {
          p2OnlyGrid = placeCard(grid, card.shape, move.x, move.y, 'p2',
            card.specialPos, move.rotation, move.isSA);
        }
      }
      // マス数が多いカードを先に表示（塗り替えられる側→塗り返す側の順）
      const p1CardSize = (p1Action !== 'pass' && p1Action !== null)
        ? (cardMap.get(p1Action.cardId)?.size ?? 0) : 0;
      const p2CardSize = move !== 'pass' ? (cardMap.get(move.cardId)?.size ?? 0) : 0;
      const p1GoesFirst = p1CardSize >= p2CardSize;

      const prevCounts = countCells(grid);
      const finalCounts = countCells(newGrid);
      const hasConflict = detectConflict(p1Action, move);

      // 新規発火SPマス数（sp-fireフェーズの表示判定用）
      const prevActivated = getActivatedSPPositions(grid);
      const newActivated  = getActivatedSPPositions(newGrid);
      const prevFiredSet  = new Set(prevActivated.p1.concat(prevActivated.p2).map(([r,c]) => `${r},${c}`));
      const newlyFiredCount = newActivated.p1.concat(newActivated.p2)
        .filter(([r,c]) => !prevFiredSet.has(`${r},${c}`)).length;

      const data: AnimData = {
        p1CardId: p1Action !== 'pass' && p1Action !== null ? p1Action.cardId : null,
        p1isSA: p1Action !== 'pass' && p1Action !== null ? p1Action.isSA : false,
        p2CardId, p2isSA, p1OnlyGrid, p2OnlyGrid, p1GoesFirst, finalGrid: newGrid,
        hasConflict, prevCounts, finalCounts,
        finalP2Hand, finalP2Pile, p2Drew, turnSnapshot: turn, newlyFiredCount,
      };

      if (animEnabled) {
        setAnimDisplayGrid(grid.map(r => [...r]));
        setAnimScore(prevCounts);
        setAnimData(data);
        setAnimPhase('reveal');
        // setCpuThinking は演出終了後にapplyAnimResultで解除
      } else {
        applyAnimResult(data);
      }
    }, CPU_DELAY);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitFor, cpuMode]);

  // ── アニメーションフェーズ進行 ───────────────────────────────────────────
  useEffect(() => {
    if (animPhase === 'idle' || !animData) return;
    let t: ReturnType<typeof setTimeout>;
    if (animPhase === 'reveal') {
      t = setTimeout(() => {
        const firstOnlyGrid = animData.p1GoesFirst ? animData.p1OnlyGrid : animData.p2OnlyGrid;
        if (animData.hasConflict && firstOnlyGrid) {
          setAnimDisplayGrid(firstOnlyGrid);
          setAnimPhase('p1-place');
        } else {
          setAnimDisplayGrid(animData.finalGrid);
          setAnimPhase('resolve');
        }
      }, 1300);
    } else if (animPhase === 'p1-place') {
      t = setTimeout(() => {
        setAnimDisplayGrid(animData.finalGrid);
        setAnimPhase('resolve');
      }, 900);
    } else if (animPhase === 'resolve') {
      t = setTimeout(() => {
        if (animData.newlyFiredCount > 0) {
          setAnimSpFlash(true);
          setAnimPhase('sp-fire');
        } else {
          // 新規発火なし → sp-fireをスキップしてscoreへ
          setAnimScore(animData.finalCounts);
          setAnimPhase('score');
        }
      }, 800);
    } else if (animPhase === 'sp-fire') {
      t = setTimeout(() => {
        setAnimSpFlash(false);
        setAnimScore(animData.finalCounts);
        setAnimPhase('score');
      }, 1100);
    } else if (animPhase === 'score') {
      t = setTimeout(() => {
        setAnimPhase('draw');
      }, 1000);
    } else if (animPhase === 'draw') {
      applyAnimResult(animData);
      t = setTimeout(() => {
        setAnimPhase('idle');
        setAnimData(null);
        setAnimDisplayGrid(null);
        setAnimSpFlash(false);
      }, 700);
    }
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animPhase]);

  // P2手動 確定
  function confirmP2Action() {
    if (waitFor !== 'p2' || cpuMode || !pending || !pending.isValid || animPhase !== 'idle') return;
    const move = { cardId: pending.cardId, x: pending.x, y: pending.y, rotation: pending.rotation, isSA: pending.isSA };
    const card = cardMap.get(pending.cardId);
    if (pending.isSA && card) {
      setP2SPSpent(s => s + card.spp);
      setP2SACount(n => n + 1);
    }
    setP2Placed(prev => [...prev, { cardId: pending.cardId, isSA: pending.isSA }]);

    // 手札・山札更新はanimResult適用時まで遅延
    const { newHand: finalP2Hand, newPile: finalP2Pile } = drawCard(pending.cardId, p2Hand, p2Pile);
    const p2Drew = p2Pile.length > 0;

    const newGrid = resolveSimultaneous(
      grid,
      p1Action !== 'pass' && p1Action !== null
        ? { cardId: p1Action.cardId, x: p1Action.x, y: p1Action.y, rotation: p1Action.rotation, isSpecialAttack: p1Action.isSA }
        : 'pass',
      { cardId: move.cardId, x: move.x, y: move.y, rotation: move.rotation, isSpecialAttack: move.isSA },
      (id) => cardMap.get(id)?.shape ?? null,
      (id) => cardMap.get(id)?.specialPos ?? null,
      (id) => cardMap.get(id)?.size ?? 0
    );

    setP2Sel(null); setPending(null); setP2SAMode(false);
    fireManualAnimation(move, newGrid, finalP2Hand, finalP2Pile, p2Drew);
  }

  /** 手動モード用：AnimDataを構築してアニメーション発火（またはanim無効時は即時適用） */
  function fireManualAnimation(
    p2Move: { cardId: string; x: number; y: number; rotation: Rotation; isSA: boolean } | 'pass',
    newGrid: CellState[][],
    finalP2Hand: string[], finalP2Pile: string[], p2Drew: boolean
  ) {
    const p2CardId = p2Move !== 'pass' ? p2Move.cardId : null;
    const p2isSA   = p2Move !== 'pass' ? p2Move.isSA : false;

    let p1OnlyGrid: CellState[][] | null = null;
    if (p1Action !== 'pass' && p1Action !== null) {
      const c = cardMap.get(p1Action.cardId);
      if (c?.shape) p1OnlyGrid = placeCard(grid, c.shape, p1Action.x, p1Action.y, 'p1',
        c.specialPos, p1Action.rotation, p1Action.isSA);
    }
    let p2OnlyGrid: CellState[][] | null = null;
    if (p2Move !== 'pass') {
      const c = cardMap.get(p2Move.cardId);
      if (c?.shape) p2OnlyGrid = placeCard(grid, c.shape, p2Move.x, p2Move.y, 'p2',
        c.specialPos, p2Move.rotation, p2Move.isSA);
    }
    const p1CardSize = (p1Action !== 'pass' && p1Action !== null) ? (cardMap.get(p1Action.cardId)?.size ?? 0) : 0;
    const p2CardSize = p2Move !== 'pass' ? (cardMap.get(p2Move.cardId)?.size ?? 0) : 0;
    const p1GoesFirst = p1CardSize >= p2CardSize;

    const prevCounts = countCells(grid);
    const finalCounts = countCells(newGrid);
    const hasConflict = detectConflict(p1Action, p2Move);

    const prevActivated = getActivatedSPPositions(grid);
    const newActivated  = getActivatedSPPositions(newGrid);
    const prevFiredSet  = new Set(prevActivated.p1.concat(prevActivated.p2).map(([r,c]) => `${r},${c}`));
    const newlyFiredCount = newActivated.p1.concat(newActivated.p2)
      .filter(([r,c]) => !prevFiredSet.has(`${r},${c}`)).length;

    const data: AnimData = {
      p1CardId: p1Action !== 'pass' && p1Action !== null ? p1Action.cardId : null,
      p1isSA: p1Action !== 'pass' && p1Action !== null ? p1Action.isSA : false,
      p2CardId, p2isSA, p1OnlyGrid, p2OnlyGrid, p1GoesFirst, finalGrid: newGrid,
      hasConflict, prevCounts, finalCounts,
      finalP2Hand, finalP2Pile, p2Drew, turnSnapshot: turn, newlyFiredCount,
    };

    if (animEnabled) {
      setAnimDisplayGrid(grid.map(r => [...r]));
      setAnimScore(prevCounts);
      setAnimData(data);
      setAnimPhase('reveal');
    } else {
      applyAnimResult(data);
    }
  }

  function advanceTurn(_currentGrid: CellState[][]) {
    if (turn >= MAX_TURNS) {
      setGameEndPending(true);
      return;
    }
    setTurn(t => t + 1);
    setP1Action(null);
    // ターン終了時に回転状態をリセット（他のカードの向きに影響させない）
    setP1Rot(0);
    setP2Rot(0);
    setWaitFor('p1');
  }

  // ── キャンバス描画 ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || screen !== 'battle') return;
    const rows = stage.height, cols = stage.width;
    canvas.width  = cols * cellSize;
    canvas.height = rows * cellSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ベースグリッド（アニメーション中はdisplayGridを使用）
    const renderGrid = (animDisplayGrid && animDisplayGrid.length > 0) ? animDisplayGrid : grid;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = renderGrid[r]?.[c] ?? 'E';
        ctx.fillStyle = CELL_COLOR[cell] ?? '#1a3a1a';
        ctx.fillRect(c*cellSize, r*cellSize, cellSize, cellSize);
        if (cell !== 'W') {
          ctx.strokeStyle = '#111';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(c*cellSize, r*cellSize, cellSize, cellSize);
        }
      }
    }

    // ホバープレビュー
    const activePlayer = waitFor === 'p1' ? 'p1' : 'p2';
    const activeSel    = activePlayer === 'p1' ? p1Sel : p2Sel;
    const activeRot    = activePlayer === 'p1' ? p1Rot : p2Rot;
    const activeSA     = activePlayer === 'p1' ? p1SAMode : p2SAMode;
    const hoverColor   = activeSA
      ? (activePlayer === 'p1' ? 'rgba(220,50,50,0.55)' : 'rgba(160,50,220,0.55)')
      : (activePlayer === 'p1' ? 'rgba(255,140,0,0.5)' : 'rgba(0,170,255,0.5)');
    const invalidColor = 'rgba(255,0,0,0.4)';

    if (activeSel && hover && !pending) {
      const card = cardMap.get(activeSel);
      if (card?.shape) {
        const shape = rotateShape(card.shape, activeRot);
        const { minR, minC } = getShapeBoundsSimple(shape);
        const px = hover.x - minC, py = hover.y - minR;
        const valid = canPlace(grid, shape, px, py, activePlayer, activeSA, false);
        ctx.fillStyle = valid ? hoverColor : invalidColor;
        for (let r = 0; r < shape.length; r++)
          for (let c = 0; c < (shape[r]?.length ?? 0); c++)
            if (shape[r][c]) ctx.fillRect((px+c)*cellSize, (py+r)*cellSize, cellSize, cellSize);
      }
    }

    // 仮配置ハイライト（有効=通常色 / 無効=赤）、SPマスは専用色で強調
    if (pending) {
      const card = cardMap.get(pending.cardId);
      if (card?.shape) {
        const shape = rotateShape(card.shape, pending.rotation);
        // SPマス位置を回転に合わせて計算
        const origRows = card.shape.length, origCols = card.shape[0]?.length ?? 0;
        let rotSP: [number,number] | null = null;
        if (card.specialPos) {
          const [sr, sc] = card.specialPos;
          switch (pending.rotation) {
            case 0:   rotSP = [sr, sc]; break;
            case 90:  rotSP = [sc, origRows-1-sr]; break;
            case 180: rotSP = [origRows-1-sr, origCols-1-sc]; break;
            case 270: rotSP = [origCols-1-sc, sr]; break;
          }
        }
        // 試し置きモードと同じ色・スタイル
        const pColor = pending.isSA
          ? (pending.player === 'p1' ? 'rgba(220,50,50,0.55)' : 'rgba(160,50,220,0.55)')
          : (pending.player === 'p1' ? 'rgba(255,140,0,0.5)' : 'rgba(0,170,255,0.5)');
        const pSpColor = pending.isSA
          ? (pending.player === 'p1' ? 'rgba(255,80,0,0.8)' : 'rgba(200,0,255,0.8)')
          : (pending.player === 'p1' ? 'rgba(255,69,0,0.7)' : 'rgba(0,204,255,0.7)');
        for (let r = 0; r < shape.length; r++)
          for (let c = 0; c < (shape[r]?.length ?? 0); c++)
            if (shape[r][c]) {
              const isSPCell = rotSP && rotSP[0] === r && rotSP[1] === c;
              ctx.fillStyle = !pending.isValid ? 'rgba(255,0,0,0.4)' : (isSPCell ? pSpColor : pColor);
              ctx.fillRect((pending.x+c)*cellSize, (pending.y+r)*cellSize, cellSize, cellSize);
            }
      }
    }

    // スタート位置マーカー
    if (stage.p1Start) {
      const [x,y] = stage.p1Start;
      if (renderGrid[y]?.[x] !== 'p1_sp') {
        ctx.strokeStyle = '#FF8C00'; ctx.lineWidth = 2;
        ctx.strokeRect(x*cellSize+1, y*cellSize+1, cellSize-2, cellSize-2);
      }
    }
    if (stage.p2Start) {
      const [x,y] = stage.p2Start;
      if (renderGrid[y]?.[x] !== 'p2_sp') {
        ctx.strokeStyle = '#00AAFF'; ctx.lineWidth = 2;
        ctx.strokeRect(x*cellSize+1, y*cellSize+1, cellSize-2, cellSize-2);
      }
    }
  }, [grid, animDisplayGrid, hover, pending, p1Sel, p2Sel, p1Rot, p2Rot, p1SAMode, p2SAMode,
      waitFor, cellSize, stage, screen, cardMap]);

  // ── 結果画面：最終盤面描画 ───────────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'result') return;
    const canvas = resultCanvasRef.current;
    if (!canvas) return;
    const resCellSize = Math.max(4, Math.min(10, Math.floor(260 / stage.width)));
    const rows = stage.height, cols = stage.width;
    canvas.width  = cols * resCellSize;
    canvas.height = rows * resCellSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r]?.[c] ?? 'E';
        ctx.fillStyle = CELL_COLOR[cell] ?? '#2a2a2a';
        ctx.fillRect(c*resCellSize, r*resCellSize, resCellSize, resCellSize);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 0.3;
        ctx.strokeRect(c*resCellSize, r*resCellSize, resCellSize, resCellSize);
      }
    }
  }, [screen, grid, stage]);

  // ── キャンバス操作 ────────────────────────────────────────────────────────
  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!canvasRef.current || screen !== 'battle') return;
    const rect = canvasRef.current.getBoundingClientRect();
    const gx = Math.floor((e.clientX - rect.left) / cellSize);
    const gy = Math.floor((e.clientY - rect.top)  / cellSize);
    handleGridTap(gx, gy);
  }

  function handleCanvasTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!canvasRef.current) return;
    const touch = e.touches[0];
    const rect  = canvasRef.current.getBoundingClientRect();
    const gx = Math.floor((touch.clientX - rect.left) / cellSize);
    const gy = Math.floor((touch.clientY - rect.top)  / cellSize);
    lastTouchRef.current = { x: gx, y: gy };
    setHover({ x: gx, y: gy });
  }

  function handleCanvasTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!canvasRef.current) return;
    const touch = e.touches[0];
    const rect  = canvasRef.current.getBoundingClientRect();
    const gx = Math.floor((touch.clientX - rect.left) / cellSize);
    const gy = Math.floor((touch.clientY - rect.top)  / cellSize);
    lastTouchRef.current = { x: gx, y: gy };
    setHover({ x: gx, y: gy });
  }

  function handleCanvasTouchEnd(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!lastTouchRef.current) return;
    const { x: gx, y: gy } = lastTouchRef.current;
    lastTouchRef.current = null;
    setHover(null);
    handleGridTap(gx, gy);
  }

  function handleCanvasMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const gx = Math.floor((e.clientX - rect.left) / cellSize);
    const gy = Math.floor((e.clientY - rect.top)  / cellSize);
    setHover({ x: gx, y: gy });
  }

  function handleGridTap(gx: number, gy: number) {
    const isP1Turn = waitFor === 'p1';
    const isP2Turn = waitFor === 'p2' && !cpuMode;
    if (!isP1Turn && !isP2Turn) return;
    if (cpuThinking || animPhase !== 'idle') return;

    const player   = isP1Turn ? 'p1' : 'p2';
    const selCard  = isP1Turn ? p1Sel : p2Sel;
    const rotation = isP1Turn ? p1Rot : p2Rot;
    const isSA     = isP1Turn ? p1SAMode : p2SAMode;

    if (!selCard) return;
    const card = cardMap.get(selCard);
    if (!card?.shape) return;

    const shape = rotateShape(card.shape, rotation);
    const { minR, minC } = getShapeBoundsSimple(shape);
    const ax = gx - minC, ay = gy - minR;

    // 有効・無効に関わらず常に仮置きセット。色と確定ボタンで有効性を示す
    const isValid = canPlace(grid, shape, ax, ay, player, isSA, false);
    const pivotX = ax + (minC + (shape[0]?.length ?? 0) / 2);
    const pivotY = ay + (minR + shape.length / 2);
    setPending({ cardId: selCard, x: ax, y: ay, pivotX, pivotY, rotation, isSA, player, isValid });
  }

  // ── 矢印ボタン ────────────────────────────────────────────────────────────
  function adjustPending(dx: number, dy: number) {
    if (!pending) return;
    const card = cardMap.get(pending.cardId);
    if (!card?.shape) return;
    const shape = rotateShape(card.shape, pending.rotation);
    const nx = pending.x + dx, ny = pending.y + dy;
    // グリッド境界チェック（完全にはみ出す場合は移動しない）
    const rows = grid.length, cols = grid[0]?.length ?? 0;
    const rRows = shape.length, rCols = shape[0]?.length ?? 0;
    if (nx + rCols <= 0 || ny + rRows <= 0 || nx >= cols || ny >= rows) return;
    const isValid = canPlace(grid, shape, nx, ny, pending.player, pending.isSA, false);
    setPending({ ...pending, x: nx, y: ny, pivotX: pending.pivotX + dx, pivotY: pending.pivotY + dy, isValid });
  }

  // ── デッキ選択UI ──────────────────────────────────────────────────────────
  const selClass = 'w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-white';

  function renderDeckSelect(
    group: string, setGroup: (v: string) => void,
    deckId: string | null, setDeckId: (id: string | null) => void
  ) {
    return (
      <div className="space-y-1">
        <select value={group} onChange={e => { setGroup(e.target.value); setDeckId(null); }} className={selClass}>
          <option value="">グループを選択...</option>
          {rootUserDecks.length > 0 && <option value="root">マイデッキ直下</option>}
          {folders.map(f => <option key={f.id} value={f.id}>📁 {f.name}</option>)}
          {sampleDecks.length > 0 && <option value="sample">サンプルデッキ</option>}
        </select>
        {group && (
          <select value={deckId ?? ''} onChange={e => setDeckId(e.target.value || null)} className={selClass}>
            <option value="">デッキを選択...</option>
            {getDecksForGroup(group).map(d => {
              const r = d.reserveCardIds?.length ?? 0;
              return <option key={d.id} value={d.id}>{d.name} ({d.cardIds.length}{r > 0 ? `+${r}` : ''}枚)</option>;
            })}
          </select>
        )}
      </div>
    );
  }

  // ── 手札カードボタン ──────────────────────────────────────────────────────
  function renderHandCard(cardId: string, isActive: boolean, isP1: boolean, placeability?: { canNormal: boolean; canSA: boolean }) {
    const card = cardMap.get(cardId);
    const sel  = isP1 ? p1Sel : p2Sel;
    const isSel = sel === cardId;
    const isSA  = isP1 ? p1SAMode : p2SAMode;
    const hasPending = pending?.cardId === cardId;

    if (!card) return null;

    // 配置可能性チェック：SAモード中はSA配置可能か、通常モードは通常配置可能か
    const placeable = placeability
      ? (isSA ? placeability.canSA : placeability.canNormal)
      : true;
    const disabled = !isActive || !placeable;

    const borderCls = hasPending
      ? 'border-yellow-400 bg-yellow-950'
      : isSel && isSA
        ? 'border-red-500 bg-red-950'
        : isSel
          ? (isP1 ? 'border-orange-500 bg-orange-950' : 'border-blue-500 bg-blue-950')
          : (isP1 ? 'border-gray-600 bg-gray-800' : 'border-gray-600 bg-gray-800');

    return (
      <div key={cardId}
        className={`rounded border p-1 transition-all select-none ${borderCls} ${disabled ? 'opacity-30 pointer-events-none grayscale' : 'cursor-pointer'}`}
        onClick={() => {
          if (disabled) return;
          if (isP1) { setP1Sel(isSel ? null : cardId); setPending(null); }
          else      { setP2Sel(isSel ? null : cardId); setPending(null); }
        }}
      >
        <div className="flex justify-center mb-0.5">
          <CardShape shape={card.shape} specialPos={card.specialPos} cellSize={handCellSize}
            p1Color={isP1 ? '#FFE000' : '#60a5fa'} spColor={isP1 ? '#FF4500' : '#00aaff'} />
        </div>
        <div className="text-center truncate leading-none" style={{ fontSize: '8px', color: '#ccc' }}>{card.name}</div>
        <div className="text-center leading-none" style={{ fontSize: '7px', color: '#888' }}>
          {card.size}m{card.spp > 0 ? ` S${card.spp}` : ''}
        </div>
      </div>
    );
  }

  // ── コントロールカラム ────────────────────────────────────────────────────
  function renderControls(isP1: boolean) {
    const isActive = animPhase === 'idle' && ((isP1 && waitFor === 'p1') || (!isP1 && waitFor === 'p2' && !cpuMode));
    const hasPend     = !!pending && pending.player === (isP1 ? 'p1' : 'p2');
    const pendValid   = hasPend && (pending?.isValid ?? false);
    const selCard  = isP1 ? p1Sel : p2Sel;
    const hasCard  = !!selCard;
    const avSP     = isP1 ? availP1SP : availP2SP;
    const isSA     = isP1 ? p1SAMode : p2SAMode;
    const setSA    = isP1 ? setP1SAMode : setP2SAMode;
    const rot      = isP1 ? p1Rot : p2Rot;
    const player   = isP1 ? 'p1' as const : 'p2' as const;
    const setRot   = isP1 ? setP1Rot : setP2Rot;
    const saCard   = selCard ? cardMap.get(selCard) : null;
    const saOk     = (saCard?.spp ?? 0) > 0 && avSP >= (saCard?.spp ?? 0);

    // 回転時: 仮置きがある場合はその位置・SAモードを維持しながら rotation のみ更新
    function applyRotation(newRot: Rotation) {
      setRot(newRot);
      if (pending && pending.player === player) {
        const card = cardMap.get(pending.cardId);
        if (card?.shape) {
          const shape = rotateShape(card.shape, newRot);
          const isValid = canPlace(grid, shape, pending.x, pending.y, player, pending.isSA, false);
          setPending({ ...pending, rotation: newRot, isValid });
        }
      }
    }
    const rotLeft  = () => applyRotation(((rot + 270) % 360) as Rotation);
    const rotRight = () => applyRotation(((rot + 90)  % 360) as Rotation);
    const btnBase  = 'w-9 h-9 rounded text-sm font-bold flex items-center justify-center select-none';
    const btnOn    = `${btnBase} bg-gray-600 active:bg-gray-500 text-white`;
    const btnOff   = `${btnBase} bg-gray-800 text-gray-600 cursor-not-allowed`;

    return (
      <div className="w-20 flex-shrink-0 border-l border-gray-700 bg-gray-900 p-1 flex flex-col gap-1 overflow-y-auto">
        {/* 十字キー */}
        <div className="flex flex-col items-center" style={{ gap: 4 }}>
          <button className={hasPend ? btnOn : btnOff} disabled={!hasPend}
            onPointerDown={e => { e.stopPropagation(); if (hasPend) adjustPending(0, -1); }}>↑</button>
          <div className="flex" style={{ gap: 0 }}>
            <button className={hasPend ? btnOn : btnOff} disabled={!hasPend}
              onPointerDown={e => { e.stopPropagation(); if (hasPend) adjustPending(-1, 0); }}>←</button>
            <button className={hasPend ? btnOn : btnOff} disabled={!hasPend}
              onPointerDown={e => { e.stopPropagation(); if (hasPend) adjustPending(1, 0); }}>→</button>
          </div>
          <button className={hasPend ? btnOn : btnOff} disabled={!hasPend}
            onPointerDown={e => { e.stopPropagation(); if (hasPend) adjustPending(0, 1); }}>↓</button>
        </div>
        {/* 回転 */}
        <div className="flex gap-0.5">
          <button className={hasCard ? btnOn : btnOff} disabled={!hasCard}
            onPointerDown={e => { e.stopPropagation(); if (hasCard) rotLeft(); }}>↺</button>
          <button className={hasCard ? btnOn : btnOff} disabled={!hasCard}
            onPointerDown={e => { e.stopPropagation(); if (hasCard) rotRight(); }}>↻</button>
        </div>
        {/* 配置確定 — 有効な仮置きのときのみ活性 */}
        <button disabled={!pendValid || !isActive}
          onClick={isP1 ? confirmP1Action : confirmP2Action}
          className={`px-1 py-1 rounded text-xs font-bold ${
            pendValid && isActive ? 'bg-green-700 active:bg-green-600 text-white' :
            hasPend && isActive   ? 'bg-red-900 text-red-400 cursor-not-allowed' :
            'bg-gray-800 text-gray-600 cursor-not-allowed'
          }`}>
          {hasPend && !pendValid ? '無効' : '確定'}
        </button>
        {/* 取消 */}
        <button disabled={!hasPend}
          onClick={() => setPending(null)}
          className={`px-1 py-1 rounded text-xs ${hasPend ? 'bg-gray-600 active:bg-gray-500 text-white' : 'bg-gray-800 text-gray-600 cursor-not-allowed'}`}>
          取消
        </button>
        {/* SA - SAモードをカード選択前に選べる */}
        {avSP > 0 && (
          <button onClick={() => { setSA(!isSA); setPending(null); }} disabled={!isActive}
            className={`px-1 py-1 rounded text-xs font-bold ${isSA ? 'bg-red-600 text-white animate-pulse' : isActive ? 'bg-red-900 text-red-300 border border-red-600' : 'bg-gray-800 text-gray-600 cursor-not-allowed'}`}>
            {isSA ? '★SA中' : (saCard && saCard.spp > 0 ? `SA(${avSP}/${saCard.spp})` : `SA(${avSP}SP)`)}
          </button>
        )}
        {/* パス */}
        <button onClick={isP1 ? handleP1Pass : handleP2Pass}
          disabled={!isActive || pending !== null}
          className={`px-1 py-1 rounded text-xs ${isActive && !pending ? 'bg-gray-700 active:bg-gray-600 text-white' : 'bg-gray-800 text-gray-600 cursor-not-allowed'}`}>
          パス
        </button>
      </div>
    );
  }

  // ── 設定画面 ──────────────────────────────────────────────────────────────
  const setupOk = !!p1DeckId && (cpuMode || !!p2DeckId);

  const setupScreen = (
    <div className="overflow-y-auto p-4 max-w-md mx-auto" style={{ height: '100%' }}>
      <h2 className="text-xl font-bold text-white mb-5">対戦モード</h2>

      {/* ステージ */}
      <div className="mb-4">
        <label className="text-sm text-gray-400 block mb-1">ステージ</label>
        <select value={stageId} onChange={e => setStageId(e.target.value)}
          className={selClass}>
          {STAGES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* P1デッキ */}
      <div className="mb-4">
        <label className="text-sm text-orange-400 font-bold block mb-1">P1 デッキ</label>
        {renderDeckSelect(p1Group, setP1Group, p1DeckId, setP1DeckId)}
      </div>

      {/* P2設定 */}
      <div className="mb-4">
        <label className="text-sm text-blue-400 font-bold block mb-2">P2 設定</label>
        <div className="flex gap-2 mb-3">
          <button type="button" onClick={() => setCpuMode(true)}
            className={`flex-1 py-2 rounded text-sm font-bold ${cpuMode ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 border border-gray-600'}`}>
            CPU対戦
          </button>
          <button type="button" onClick={() => setCpuMode(false)}
            className={`flex-1 py-2 rounded text-sm font-bold ${!cpuMode ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 border border-gray-600'}`}>
            手動（2人）
          </button>
        </div>

        {cpuMode ? (
          <div>
            <label className="text-xs text-gray-400 block mb-2">CPU レベル</label>
            <div className="grid grid-cols-4 gap-2 mb-2">
              {([1,2,3,4] as CpuLevel[]).map(lv => (
                <button key={lv} type="button" onClick={() => setCpuLevel(lv)}
                  className={`py-2 rounded text-sm font-bold ${cpuLevel === lv ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 border border-gray-600'}`}>
                  Lv{lv}
                </button>
              ))}
            </div>
            <div className="mb-3 text-xs text-gray-500">
              {cpuLevel === 1 && 'アグロ：敵陣への積極侵入を優先'}
              {cpuLevel === 2 && 'コントロール：SP蓄積・手札温存を優先'}
              {cpuLevel === 3 && 'バランス：状況に応じた戦術切り替え'}
              {cpuLevel === 4 && '先読み：P1の動きを読み守備的に展開'}
            </div>
            <label className="text-xs text-gray-400 block mb-1">
              CPUデッキ
              <span className="text-gray-600 ml-1">（未選択時は全カードからランダム）</span>
            </label>
            {renderDeckSelect(p2Group, setP2Group, p2DeckId, setP2DeckId)}
          </div>
        ) : (
          <div>
            <label className="text-xs text-gray-400 block mb-1">P2 デッキ</label>
            {renderDeckSelect(p2Group, setP2Group, p2DeckId, setP2DeckId)}
          </div>
        )}
      </div>

      <button type="button" onClick={startBattle} disabled={!setupOk}
        className="w-full py-3 bg-orange-600 active:bg-orange-500 disabled:opacity-40 text-white rounded font-bold text-lg">
        対戦開始
      </button>
    </div>
  );

  // ── 結果画面 ──────────────────────────────────────────────────────────────
  const p1Score = counts.p1, p2Score = counts.p2;
  const winner  = p1Score > p2Score ? 'P1' : p2Score > p1Score ? 'P2 (CPU)' : null;

  const resultScreen = (
    <div className="overflow-y-auto" style={{ height: '100%', backgroundColor: '#0d1f0d' }}>
      <div className="px-4 pt-4 pb-2 max-w-lg mx-auto">
        {/* 勝敗 */}
        <div className="text-center mb-3">
          <h2 className="text-xl font-bold text-white mb-1">ゲーム終了！</h2>
          {winner
            ? <div className="text-2xl font-bold text-yellow-400">{winner} の勝利！</div>
            : <div className="text-xl font-bold text-gray-300">引き分け！</div>}
        </div>

        {/* スコア */}
        <div className="flex gap-4 justify-center mb-3">
          <div className="flex-1 bg-orange-950 border border-orange-700 rounded-lg p-3 text-center">
            <div className="text-orange-400 font-bold text-sm">P1</div>
            <div className="text-white text-3xl font-bold tabular-nums">{p1Score}</div>
            <div className="text-gray-500 text-xs">マス</div>
          </div>
          <div className="flex-1 bg-blue-950 border border-blue-700 rounded-lg p-3 text-center">
            <div className="text-blue-400 font-bold text-sm">{cpuMode ? 'CPU' : 'P2'}</div>
            <div className="text-white text-3xl font-bold tabular-nums">{p2Score}</div>
            <div className="text-gray-500 text-xs">マス</div>
          </div>
        </div>

        {/* 最終盤面 */}
        <div className="mb-3">
          <div className="text-xs text-gray-500 mb-1 text-center">最終盤面</div>
          <div className="overflow-x-auto flex justify-center">
            <canvas
              ref={resultCanvasRef}
              style={{ imageRendering: 'pixelated', display: 'block', border: '1px solid #444' }}
            />
          </div>
          {/* 凡例 */}
          <div className="flex justify-center gap-3 mt-1.5 text-xs text-gray-500">
            <span><span style={{ display:'inline-block', width:8, height:8, background:'#b35c00', verticalAlign:'middle', marginRight:2 }} />P1</span>
            <span><span style={{ display:'inline-block', width:8, height:8, background:'#ff4500', verticalAlign:'middle', marginRight:2 }} />P1 SP</span>
            <span><span style={{ display:'inline-block', width:8, height:8, background:'#00308f', verticalAlign:'middle', marginRight:2 }} />{cpuMode ? 'CPU' : 'P2'}</span>
            <span><span style={{ display:'inline-block', width:8, height:8, background:'#00aaff', verticalAlign:'middle', marginRight:2 }} />{cpuMode ? 'CPU' : 'P2'} SP</span>
          </div>
        </div>

        {/* 統計 */}
        <div className="bg-gray-800 rounded-lg p-3 mb-4">
          <div className="text-xs text-gray-400 font-bold mb-2">統計</div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="text-gray-400">項目</div>
            <div className="text-orange-400 text-center">P1</div>
            <div className="text-blue-400 text-center">{cpuMode ? 'CPU' : 'P2'}</div>
            <div className="text-gray-400">SA使用回数</div>
            <div className="text-white text-center">{p1SACount}</div>
            <div className="text-white text-center">{p2SACount}</div>
            <div className="text-gray-400">SP蓄積</div>
            <div className="text-white text-center">{p1SPAccum}</div>
            <div className="text-white text-center">{p2SPAccum}</div>
          </div>
        </div>

        <div className="flex gap-3 pb-4">
          <button type="button" onClick={startBattle} disabled={!setupOk}
            className="flex-1 py-2 bg-orange-600 active:bg-orange-500 disabled:opacity-40 text-white rounded font-bold">
            もう一度
          </button>
          <button type="button" onClick={() => { clearBattleState(); setScreen('setup'); }}
            className="flex-1 py-2 bg-gray-700 active:bg-gray-600 text-white rounded font-bold">
            設定に戻る
          </button>
        </div>
      </div>
    </div>
  );

  // ── 対戦画面（共通パーツ） ────────────────────────────────────────────────
  // SA が使用可能かどうか（手札に1枚でもSA可能なカードがあるか）
  const p1SAAvail = p1Hand.some(id => { const c = cardMap.get(id); return (c?.spp ?? 0) > 0 && availP1SP >= (c?.spp ?? 0); });
  const p2SAAvail = p2Hand.some(id => { const c = cardMap.get(id); return (c?.spp ?? 0) > 0 && availP2SP >= (c?.spp ?? 0); });

  const statusBar = (
    <div className="flex-shrink-0 bg-gray-900 border-b border-gray-700">
    <style>{`
      @keyframes bsim-flame-p1 { 0%{background-position:50% 100%} 50%{background-position:50% 0%} 100%{background-position:50% 100%} }
      @keyframes bsim-flame-p2 { 0%{background-position:50% 100%} 50%{background-position:50% 0%} 100%{background-position:50% 100%} }
      .bsim-fp1 { background:linear-gradient(to top,#CC1100,#FF2200,#FF4500,#FF8C00,#FFE000,#FF8C00,#FF4500); background-size:100% 500%; box-shadow:0 0 5px #FF4500; animation:bsim-flame-p1 1.4s ease-in-out infinite; }
      .bsim-fp2 { background:linear-gradient(to top,#001199,#0033CC,#0044FF,#0088FF,#00CCFF,#00FFFF,#00CCFF); background-size:100% 500%; box-shadow:0 0 5px #00CCFF; animation:bsim-flame-p2 1.4s ease-in-out infinite; }
      .bsim-fp1:nth-child(2n){animation-delay:0.2s} .bsim-fp1:nth-child(3n){animation-delay:0.4s} .bsim-fp1:nth-child(4n){animation-delay:0.6s}
      .bsim-fp2:nth-child(2n){animation-delay:0.2s} .bsim-fp2:nth-child(3n){animation-delay:0.4s} .bsim-fp2:nth-child(4n){animation-delay:0.6s}
      @keyframes bsim-reveal-in { 0%{opacity:0;transform:scale(0.7)} 60%{opacity:1;transform:scale(1.05)} 100%{opacity:1;transform:scale(1)} }
      @keyframes bsim-sp-flash { 0%{opacity:0} 30%{opacity:0.7} 80%{opacity:0.7} 100%{opacity:0} }
      @keyframes bsim-score-pop { 0%{transform:scale(1)} 40%{transform:scale(1.3)} 100%{transform:scale(1)} }
      @keyframes bsim-sa-wave-p1 {
        0%  {box-shadow:0 0 0 0 rgba(255,140,0,0);border-color:#FF8C00}
        20% {box-shadow:0 0 14px 5px rgba(255,200,0,0.95),0 0 28px 10px rgba(255,140,0,0.6);border-color:#FFE000}
        45% {box-shadow:0 0 6px 2px rgba(255,140,0,0.5);border-color:#FF8C00}
        65% {box-shadow:0 0 20px 7px rgba(255,160,0,0.9),0 0 36px 12px rgba(255,100,0,0.4);border-color:#FFAA00}
        85% {box-shadow:0 0 10px 3px rgba(255,140,0,0.6);border-color:#FF8C00}
        100%{box-shadow:0 0 4px 1px rgba(255,140,0,0.2);border-color:#FF8C00}
      }
      @keyframes bsim-sa-wave-p2 {
        0%  {box-shadow:0 0 0 0 rgba(0,136,255,0);border-color:#0088FF}
        20% {box-shadow:0 0 14px 5px rgba(0,200,255,0.95),0 0 28px 10px rgba(0,136,255,0.6);border-color:#00EEFF}
        45% {box-shadow:0 0 6px 2px rgba(0,136,255,0.5);border-color:#0088FF}
        65% {box-shadow:0 0 20px 7px rgba(0,160,255,0.9),0 0 36px 12px rgba(0,100,255,0.4);border-color:#00AAFF}
        85% {box-shadow:0 0 10px 3px rgba(0,136,255,0.6);border-color:#0088FF}
        100%{box-shadow:0 0 4px 1px rgba(0,136,255,0.2);border-color:#0088FF}
      }
      .bsim-reveal-card { animation:bsim-reveal-in 0.4s ease-out forwards; }
      .bsim-sa-wave-p1 { animation:bsim-sa-wave-p1 1.3s ease-in-out forwards; }
      .bsim-sa-wave-p2 { animation:bsim-sa-wave-p2 1.3s ease-in-out forwards; }
      .bsim-sp-flash-overlay { animation:bsim-sp-flash 0.55s ease-out forwards; }
      .bsim-score-pop { animation:bsim-score-pop 0.45s ease-out forwards; }
    `}</style>
      {/* ターン・スコア行 */}
      <div className="flex items-center gap-2 px-2 py-0.5">
        <span className="text-xs text-gray-400 font-mono">T{turn}/{MAX_TURNS}</span>
        <span className={`text-orange-400 text-xs font-bold ${animPhase === 'score' ? 'bsim-score-pop' : ''}`}>
          P1:{animPhase !== 'idle' ? animScore.p1 : p1Score}マス
          {pendingCounts !== null && animPhase === 'idle' && (
            <span className="text-yellow-400 ml-0.5">→{pendingCounts.p1}</span>
          )}
        </span>
        <span className={`text-blue-400 text-xs font-bold ${animPhase === 'score' ? 'bsim-score-pop' : ''}`}>
          {cpuMode ? 'CPU' : 'P2'}:{animPhase !== 'idle' ? animScore.p2 : p2Score}マス
          {pendingCounts !== null && animPhase === 'idle' && (
            <span className="text-yellow-400 ml-0.5">→{pendingCounts.p2}</span>
          )}
        </span>
        <span className="ml-auto flex items-center gap-2 text-xs">
          {cpuThinking
            ? <span className="text-blue-300 animate-pulse">CPU思考中...</span>
            : <span className="text-gray-500">{waitFor === 'p1' ? 'P1のターン' : cpuMode ? '' : 'P2のターン'}</span>
          }
          <button
            onClick={() => setAnimEnabled(e => !e)}
            className={`px-2 py-0.5 rounded text-xs ${animEnabled ? 'bg-indigo-800 text-indigo-200' : 'bg-gray-700 text-gray-500'}`}
            style={tap}
          >{animEnabled ? '演出ON' : '演出OFF'}</button>
          <button
            onClick={() => setShowExitConfirm(true)}
            className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-gray-300 rounded text-xs"
            style={tap}
          >終了</button>
        </span>
      </div>
      {/* サイズスライダー行 */}
      <div className="flex items-center gap-3 px-2 py-0.5 border-t border-gray-800">
        <span className="text-gray-600 shrink-0" style={{ fontSize: '9px' }}>ステージ</span>
        <input type="range" min={6} max={18} value={cellSize}
          onChange={e => setCellSize(Number(e.target.value))}
          className="flex-1 h-1 accent-orange-500" style={{ touchAction: 'none' }} />
        <span className="text-gray-600 shrink-0" style={{ fontSize: '9px' }}>手札</span>
        <input type="range" min={2} max={5} value={handCellSize}
          onChange={e => setHandCellSize(Number(e.target.value))}
          className="flex-1 h-1 accent-blue-500" style={{ touchAction: 'none' }} />
      </div>
      {/* SP行 */}
      <div className="flex items-center gap-3 px-2 py-0.5 border-t border-gray-800 flex-wrap">
        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${
          p1SAAvail ? 'bg-yellow-900 border border-yellow-500 animate-pulse' : ''
        }`}>
          <span className="text-orange-400 text-xs font-bold">P1 SP:</span>
          {availP1SP > 0 ? (
            <div className="flex flex-wrap" style={{ gap: '1px' }}>
              {Array.from({ length: availP1SP }).map((_, i) => (
                <div key={i} className="bsim-fp1" style={{ width: 6, height: 6, borderRadius: 1, marginRight: (i + 1) % 5 === 0 && i + 1 < availP1SP ? 3 : 0 }} />
              ))}
            </div>
          ) : <span className="text-gray-600 text-xs">0</span>}
          {p1SAAvail && <span className="text-yellow-400 text-xs font-bold">★SA可</span>}
        </div>
        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${
          p2SAAvail ? 'bg-yellow-900 border border-yellow-500 animate-pulse' : ''
        }`}>
          <span className="text-blue-400 text-xs font-bold">{cpuMode ? 'CPU' : 'P2'} SP:</span>
          {availP2SP > 0 ? (
            <div className="flex flex-wrap" style={{ gap: '1px' }}>
              {Array.from({ length: availP2SP }).map((_, i) => (
                <div key={i} className="bsim-fp2" style={{ width: 6, height: 6, borderRadius: 1, marginRight: (i + 1) % 5 === 0 && i + 1 < availP2SP ? 3 : 0 }} />
              ))}
            </div>
          ) : <span className="text-gray-600 text-xs">0</span>}
          {p2SAAvail && <span className="text-yellow-400 text-xs font-bold">★SA可</span>}
        </div>
      </div>
    </div>
  );

  // 配置済みカードサイドバー
  const placedSidebar = (
    <div className="w-20 flex-shrink-0 border-r border-gray-700 bg-gray-950 p-1 overflow-y-auto">
      <div className="text-orange-400 font-bold mb-0.5 border-b border-orange-900 pb-0.5" style={{ fontSize: '9px' }}>
        P1配置 ({p1Placed.length})
      </div>
      {p1Placed.map(({ cardId, isSA }, i) => (
        <div key={i} className="truncate leading-tight" style={{ fontSize: '9px' }}>
          <span className="text-gray-300">{cardMap.get(cardId)?.name ?? '?'}</span>
          {isSA && <span className="text-red-400 ml-0.5">(SA)</span>}
        </div>
      ))}
      <div className="mt-2 text-blue-400 font-bold mb-0.5 border-b border-blue-900 pb-0.5" style={{ fontSize: '9px' }}>
        {cpuMode ? 'CPU' : 'P2'}配置 ({p2Placed.length})
      </div>
      {p2Placed.map(({ cardId, isSA }, i) => (
        <div key={i} className="truncate leading-tight" style={{ fontSize: '9px' }}>
          <span className="text-gray-300">{cardMap.get(cardId)?.name ?? '?'}</span>
          {isSA && <span className="text-red-400 ml-0.5">(SA)</span>}
        </div>
      ))}
    </div>
  );

  // ── カード演出オーバーレイ（SPフラッシュのみ・テキストはサイドパネルへ） ──
  const animOverlay = (animPhase !== 'idle' && animData) ? (() => {
    const showSPFlash = animPhase === 'sp-fire';
    return (
      <div style={{ position:'fixed', inset:0, zIndex:40, pointerEvents:'none' }}>
        {/* SP発火フラッシュ（背景のみ・テキストはカードパネル内） */}
        {showSPFlash && animSpFlash && (
          <div className="bsim-sp-flash-overlay"
            style={{ position:'absolute', inset:0, background:'rgba(0,180,255,0.2)', zIndex:1 }} />
        )}
      </div>
    );
  })() : null;

  // ── アニメーション中カードサイドパネル（常時96px確保・canvas位置を固定） ──
  const animCardPanel = (() => {
    const showContent = animPhase !== 'idle' && animData !== null;
    // SA波エフェクトはrevealフェーズ中のみ発動
    const saPhase = animPhase === 'reveal';
    const showSPCharge = animPhase === 'sp-fire' && animSpFlash;
    const p1Card = showContent && animData!.p1CardId ? cardMap.get(animData!.p1CardId) : null;
    const p2Card = showContent && animData!.p2CardId ? cardMap.get(animData!.p2CardId) : null;
    // スマホ（portrait）は小さく、PC（landscape）はそのまま
    const cardCellSize = isLandscape ? 4 : 2;
    const panelWidth   = isLandscape ? 96 : 64;
    const cardPad      = isLandscape ? '6px 8px' : '3px 4px';
    const nameMaxW     = isLandscape ? 84 : 56;
    return (
      <div style={{
        display:'flex', flexDirection:'column', justifyContent:'space-around', alignItems:'center',
        width:panelWidth, minWidth:panelWidth, flexShrink:0,
        background: showContent ? 'rgba(10,10,20,0.92)' : 'transparent',
        borderLeft: showContent ? '1px solid #333' : 'none',
        padding: showContent ? (isLandscape ? '8px 4px' : '4px 2px') : '0', gap: isLandscape ? 8 : 4,
      }}>
        {showContent && (
          <>
            {/* P2（CPU）カード - 上段 */}
            <div
              className={`flex flex-col items-center${animData!.p2isSA && saPhase ? ' bsim-sa-wave-p2' : ''}`}
              style={{
                background:'rgba(0,10,30,0.95)',
                border:`2px solid ${animData!.p2isSA ? '#FF4500' : '#0088FF'}`,
                borderRadius:8, padding:cardPad, width:'100%',
              }}>
              <div className="text-blue-400 font-bold text-xs mb-1">
                {cpuMode ? 'CPU' : 'P2'}{animData!.p2isSA ? ' ⚡SA' : ''}
              </div>
              {p2Card
                ? <>
                    <CardShape shape={p2Card.shape} specialPos={p2Card.specialPos} cellSize={cardCellSize} p1Color="#0044FF" spColor="#00CCFF" />
                    <div className="text-white font-bold mt-1 text-center" style={{ fontSize: isLandscape ? '12px' : '9px', maxWidth:nameMaxW, wordBreak:'break-all' }}>{p2Card.name}</div>
                  </>
                : <div className="text-gray-400 text-xs">パス</div>
              }
            </div>
            {/* SP CHARGE テキスト（sp-fireフェーズのみ・カードパネル内に表示） */}
            {showSPCharge && (
              <div style={{
                background:'rgba(0,30,60,0.95)', borderRadius:6, padding: isLandscape ? '5px 6px' : '3px 4px',
                border:'1px solid rgba(0,200,255,0.5)', width:'100%', textAlign:'center',
              }}>
                <div className="text-cyan-300 font-bold animate-pulse" style={{ fontSize: isLandscape ? '10px' : '8px', letterSpacing:'0.05em' }}>⚡ SP CHARGE！</div>
              </div>
            )}
            {/* P1カード - 下段 */}
            <div
              className={`flex flex-col items-center${animData!.p1isSA && saPhase ? ' bsim-sa-wave-p1' : ''}`}
              style={{
                background:'rgba(20,10,0,0.95)',
                border:'2px solid #FF8C00',
                borderRadius:8, padding:cardPad, width:'100%',
              }}>
              <div className="text-orange-400 font-bold text-xs mb-1">
                P1{animData!.p1isSA ? ' ⚡SA' : ''}
              </div>
              {p1Card
                ? <>
                    <CardShape shape={p1Card.shape} specialPos={p1Card.specialPos} cellSize={cardCellSize} p1Color="#FFE000" spColor="#FF4500" />
                    <div className="text-white font-bold mt-1 text-center" style={{ fontSize: isLandscape ? '12px' : '9px', maxWidth:nameMaxW, wordBreak:'break-all' }}>{p1Card.name}</div>
                  </>
                : <div className="text-gray-400 text-xs">パス</div>
              }
            </div>
          </>
        )}
      </div>
    );
  })();

  const canvasArea = (
    <div className="flex-1 overflow-auto flex items-start justify-center p-1"
      onMouseLeave={() => setHover(null)}>
      <div style={{ display:'flex', flexDirection:'row', alignItems:'flex-start' }}>
      <div style={{ position:'relative', display:'inline-block' }}>
        <canvas ref={canvasRef}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMouseMove}
          onTouchStart={handleCanvasTouchStart}
          onTouchMove={handleCanvasTouchMove}
          onTouchEnd={handleCanvasTouchEnd}
          className="cursor-crosshair border border-gray-700 touch-none"
          style={{ imageRendering:'pixelated', display:'block' }}
        />
        {/* 活性化SPマス フレームオーバーレイ（カード配置中は非表示にしてタイミングを分離） */}
        {activatedSPPos && animPhase !== 'reveal' && animPhase !== 'p1-place' && animPhase !== 'resolve' && (
          <div style={{ position:'absolute', top:0, left:0, pointerEvents:'none' }}>
            {activatedSPPos.p1.map(([r,c]) => (
              <div key={`p1sp-${r}-${c}`} className="bsim-fp1"
                style={{ position:'absolute', left:c*cellSize, top:r*cellSize, width:cellSize, height:cellSize, opacity:0.75 }} />
            ))}
            {activatedSPPos.p2.map(([r,c]) => (
              <div key={`p2sp-${r}-${c}`} className="bsim-fp2"
                style={{ position:'absolute', left:c*cellSize, top:r*cellSize, width:cellSize, height:cellSize, opacity:0.75 }} />
            ))}
          </div>
        )}
      </div>
      {animCardPanel}
      </div>
    </div>
  );

  // P1手札エリア（常に表示）
  const p1HandArea = (
    <div className="flex-shrink-0 border-t border-gray-700 bg-gray-900 p-1.5">
      <div className="flex items-center gap-1 mb-1">
        <span className="text-xs text-orange-400 font-bold">P1手札（{p1Hand.length}枚）</span>
        {turn === 1 && !reshuffled && waitFor === 'p1' && !cpuThinking && (
          <button type="button" onClick={handleReshuffle}
            className="ml-auto text-xs px-2 py-0.5 bg-gray-700 active:bg-gray-600 text-gray-300 rounded select-none">
            リシャッフル
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1">
        {p1Hand.map(id => renderHandCard(id, waitFor === 'p1' && !cpuThinking, true, p1HandPlaceability.get(id)))}
      </div>
      {/* CPUアナウンス */}
      {cpuMessage && (
        <div className="mt-1 px-2 py-1 bg-blue-950 border border-blue-700 rounded text-blue-200 text-xs text-center">
          {cpuMessage}
        </div>
      )}
      {/* デッキ（全15枚・ドロー済みはグレー） */}
      <div className="mt-1">
        <button type="button" style={tap}
          onClick={() => setShowP1Pile(p => !p)}
          className="flex items-center gap-1 text-gray-500 hover:text-gray-300 text-xs select-none">
          <span>{showP1Pile ? '▼' : '▶'}</span>
          <span>デッキ（残り{p1Pile.length}枚 / 全{p1FullDeck.length}枚）</span>
        </button>
        {showP1Pile && p1DeckDisplay.length > 0 && (
          <div className="mt-1 max-h-40 overflow-y-auto bg-gray-950 rounded p-1">
            <div className="grid grid-cols-3 gap-1">
              {p1DeckDisplay.map(({ id, drawn }, i) => {
                const c = cardMap.get(id);
                if (!c) return null;
                return (
                  <div key={i} className={`bg-gray-900 rounded p-0.5 flex flex-col items-center ${drawn ? 'opacity-30 grayscale' : ''}`}>
                    <div className="flex justify-center">
                      <CardShape shape={c.shape} specialPos={c.specialPos} cellSize={2}
                        p1Color="#FFE000" spColor="#FF4500" />
                    </div>
                    <div className="text-center truncate w-full leading-none mt-0.5" style={{ fontSize: '7px', color: drawn ? '#555' : '#aaa' }}>{c.name}</div>
                    <div className="text-center leading-none" style={{ fontSize: '6px', color: '#666' }}>{c.size}m{c.spp > 0 ? ` S${c.spp}` : ''}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // P2手札エリア（手動時のみ）
  const p2HandArea = !cpuMode ? (
    <div className="flex-shrink-0 border-t border-gray-700 bg-gray-800 p-1.5">
      <div className="text-xs text-blue-400 font-bold mb-1">
        P2手札（{p2Hand.length}枚）　SP: {availP2SP}
      </div>
      <div className="grid grid-cols-4 gap-1">
        {p2Hand.map(id => renderHandCard(id, waitFor === 'p2' && !cpuThinking, false, p2HandPlaceability.get(id)))}
      </div>
      {/* デッキ（全15枚・ドロー済みはグレー） */}
      <div className="mt-1">
        <button type="button" style={tap}
          onClick={() => setShowP2Pile(p => !p)}
          className="flex items-center gap-1 text-gray-500 hover:text-gray-300 text-xs select-none">
          <span>{showP2Pile ? '▼' : '▶'}</span>
          <span>デッキ（残り{p2Pile.length}枚 / 全{p2FullDeck.length}枚）</span>
        </button>
        {showP2Pile && p2DeckDisplay.length > 0 && (
          <div className="mt-1 max-h-40 overflow-y-auto bg-gray-950 rounded p-1">
            <div className="grid grid-cols-3 gap-1">
              {p2DeckDisplay.map(({ id, drawn }, i) => {
                const c = cardMap.get(id);
                if (!c) return null;
                return (
                  <div key={i} className={`bg-gray-900 rounded p-0.5 flex flex-col items-center ${drawn ? 'opacity-30 grayscale' : ''}`}>
                    <div className="flex justify-center">
                      <CardShape shape={c.shape} specialPos={c.specialPos} cellSize={2}
                        p1Color="#60a5fa" spColor="#00aaff" />
                    </div>
                    <div className="text-center truncate w-full leading-none mt-0.5" style={{ fontSize: '7px', color: drawn ? '#555' : '#aaa' }}>{c.name}</div>
                    <div className="text-center leading-none" style={{ fontSize: '6px', color: '#666' }}>{c.size}m{c.spp > 0 ? ` S${c.spp}` : ''}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  ) : null;

  // カードトラッシュ選択オーバーレイ
  const trashHand = trashMode === 'p1' ? p1Hand : p2Hand;
  const trashOverlay = trashMode !== null ? (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-end bg-black/60">
      <div className="w-full bg-gray-900 border-t border-gray-600 p-3 max-w-lg mx-auto">
        <p className="text-white text-sm font-bold text-center mb-0.5">カードを1枚トラッシュ → SP +1</p>
        <p className="text-gray-400 text-xs text-center mb-2">選んだカードをデッキから除外してパスします</p>
        <div className="grid grid-cols-4 gap-2 mb-3">
          {trashHand.map(cardId => {
            const card = cardMap.get(cardId);
            if (!card) return null;
            return (
              <button key={cardId}
                onClick={() => completeTrashPass(cardId)}
                className="bg-gray-700 hover:bg-red-900 active:bg-red-800 border border-gray-500 rounded p-1 text-center"
                style={tap}
              >
                <CardShape shape={card.shape} specialPos={card.specialPos} cellSize={3}
                  p1Color="#FFE000" spColor="#FF4500" />
                <div className="text-gray-300 truncate leading-tight mt-0.5" style={{ fontSize: '8px' }}>{card.name}</div>
                <div className="text-red-400 font-bold" style={{ fontSize: '8px' }}>トラッシュ</div>
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setTrashMode(null)}
          className="w-full py-1.5 bg-gray-700 active:bg-gray-600 text-gray-300 rounded text-sm"
          style={tap}
        >キャンセル（パスしない）</button>
      </div>
    </div>
  ) : null;

  // 途中終了確認ダイアログ
  const exitConfirmEl = showExitConfirm ? (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 mx-4 max-w-xs w-full shadow-2xl">
        <p className="text-white text-sm font-bold mb-1 text-center">対戦を終了しますか？</p>
        <p className="text-gray-400 text-xs text-center mb-5">対戦データはリセットされます。</p>
        <div className="flex gap-3">
          <button
            onClick={() => { setShowExitConfirm(false); clearBattleState(); setScreen('setup'); }}
            className="flex-1 py-2 bg-red-700 active:bg-red-600 text-white rounded font-bold text-sm"
            style={tap}
          >終了する</button>
          <button
            onClick={() => setShowExitConfirm(false)}
            className="flex-1 py-2 bg-gray-600 active:bg-gray-500 text-white rounded font-bold text-sm"
            style={tap}
          >続ける</button>
        </div>
      </div>
    </div>
  ) : null;

  // ── ゲーム終了オーバーレイ ────────────────────────────────────────────────
  const gameEndOverlay = gameEndPending ? (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-gray-900 border border-gray-600 rounded-xl p-6 mx-4 max-w-xs w-full shadow-2xl text-center">
        <div className="text-2xl font-bold text-white mb-2">ゲーム終了！</div>
        <div className="flex gap-4 justify-center mb-4 text-lg font-bold">
          <span className="text-orange-400">P1: {counts.p1}マス</span>
          <span className="text-blue-400">{cpuMode ? 'CPU' : 'P2'}: {counts.p2}マス</span>
        </div>
        <button
          onClick={() => { setGameEndPending(false); clearBattleState(); setScreen('result'); }}
          className="w-full py-2 bg-orange-600 active:bg-orange-500 text-white rounded font-bold text-sm"
          style={tap}
        >結果を見る</button>
      </div>
    </div>
  ) : null;

  // ── 対戦画面レイアウト ────────────────────────────────────────────────────
  if (screen === 'setup')  return setupScreen;
  if (screen === 'result') return resultScreen;

  // landscape
  if (isLandscape) {
    return (
      <div className="flex flex-row overflow-hidden" style={{ height: '100%', position: 'relative' }}>
        {animOverlay}
        {trashOverlay}
        {exitConfirmEl}
        {gameEndOverlay}
        {/* 左: ステージ + 操作 */}
        <div className="flex flex-col overflow-hidden border-r border-gray-700" style={{ width: '55%' }}>
          {statusBar}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {placedSidebar}
            {canvasArea}
            {renderControls(waitFor === 'p1')}
          </div>
        </div>
        {/* 右: 手札 */}
        <div className="flex flex-col overflow-hidden" style={{ width: '45%' }}>
          {p1HandArea}
          {p2HandArea}
          {cpuMode && (
            <div className="flex-1 flex items-center justify-center text-gray-600 text-xs p-2">
              {cpuThinking
                ? <span className="text-blue-300 animate-pulse">CPU思考中...</span>
                : 'CPUターン待機中'}
            </div>
          )}
        </div>
      </div>
    );
  }

  // portrait
  return (
    <div className="flex flex-col overflow-hidden" style={{ height: '100%', position: 'relative' }}>
      {animOverlay}
      {trashOverlay}
      {exitConfirmEl}
      {gameEndOverlay}
      {statusBar}
      {/* ステージ + 操作（配置済みサイドバー含む） */}
      <div className="flex flex-shrink-0 overflow-hidden" style={{ maxHeight: '50vh' }}>
        {placedSidebar}
        <div className="flex flex-1 min-w-0 overflow-auto">
          {canvasArea}
          {renderControls(waitFor === 'p1')}
        </div>
      </div>
      {/* 手札 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {p1HandArea}
        {p2HandArea}
      </div>
    </div>
  );
}
