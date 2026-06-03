import { useState, useEffect, useRef, useMemo } from 'react';
import { useStore, isSampleDeck } from '../../store';
import type { CellState, Deck, CpuLevel } from '../../types';
import { CardShape } from '../common/CardShape';
import stagesData from '../../data/stages.json';
import type { Stage } from '../../types';
import { rotateShape } from '../../utils/cardShape';
import {
  canPlace, placeCard, resolveSimultaneous,
  shuffleDeck, countCells, getActivatedSPPositions,
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

// ─── セルの色 ─────────────────────────────────────────────────────────────────
const CELL_COLOR: Record<CellState, string> = {
  E: '#2a2a2a', W: '#111', B: '#1a1a1a', blocked: '#333',
  p1: '#b35c00', p1_sp: '#ff4500', p2: '#00308f', p2_sp: '#00aaff',
};

// ─── 型 ───────────────────────────────────────────────────────────────────────
interface PendingPlacement {
  cardId: string; x: number; y: number;
  pivotX: number; pivotY: number;
  rotation: Rotation; isSA: boolean; player: 'p1' | 'p2';
  isValid: boolean;  // canPlace()の結果。falseでも仮置きは表示する
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

  // ── UI状態 ────────────────────────────────────────────────────────────────
  const [p1Sel,     setP1Sel]     = useState<string | null>(null);
  const [p2Sel,     setP2Sel]     = useState<string | null>(null);
  const [p1Rot,     setP1Rot]     = useState<Rotation>(0);
  const [p2Rot,     setP2Rot]     = useState<Rotation>(0);
  const [p1SAMode,  setP1SAMode]  = useState(false);
  const [p2SAMode,  setP2SAMode]  = useState(false);
  const [pending,   setPending]   = useState<PendingPlacement | null>(null);
  const [hover,     setHover]     = useState<{ x: number; y: number } | null>(null);
  const cellSize = 10;

  // ── 派生値 ────────────────────────────────────────────────────────────────
  const cardMap = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards]);
  const stage = useMemo(() => STAGES.find(s => s.id === stageId) ?? STAGES[0], [stageId]);

  const counts  = useMemo(() => countCells(grid), [grid]);
  const availP1SP = p1SPAccum - p1SPSpent;
  const availP2SP = p2SPAccum - p2SPSpent;

  const stageInfo = useMemo<StageInfo | undefined>(() => {
    if (!stage.p1Start || !stage.p2Start) return undefined;
    return {
      p1StartRow: stage.p1Start[1],
      p2StartRow: stage.p2Start[1],
      rows: stage.height,
      cols: stage.width,
    };
  }, [stage]);

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
    };
    try { localStorage.setItem(BATTLE_SAVE_KEY, JSON.stringify(save)); } catch {}
  }, [screen, grid, p1Hand, p2Hand, p1Pile, p2Pile, turn, waitFor, p1Action,
      p1SPAccum, p2SPAccum, p1SPSpent, p2SPSpent, p1SACount, p2SACount,
      reshuffled, p1Placed, p2Placed, cpuMode, cpuLevel, stageId, p1DeckId, p2DeckId]);

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

  // ── カードを引く（使用後に補充） ──────────────────────────────────────────
  function drawCard(
    usedCardId: string,
    hand: string[], pile: string[]
  ): { newHand: string[]; newPile: string[] } {
    const newHand = hand.filter(id => id !== usedCardId);
    if (pile.length > 0) {
      newHand.push(pile[0]);
      return { newHand, newPile: pile.slice(1) };
    }
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
    if (waitFor !== 'p2' || cpuMode) return;
    if (p2Hand.length > 0) {
      setTrashMode('p2');
    } else {
      // カードなし：直接パス
      setP2SPAccum(prev => prev + 1);
      let newGrid = grid;
      if (p1Action !== 'pass' && p1Action !== null) {
        const card = cardMap.get(p1Action.cardId);
        if (card?.shape) {
          newGrid = placeCard(grid, card.shape, p1Action.x, p1Action.y, 'p1',
            card.specialPos, p1Action.rotation, p1Action.isSA);
        }
      }
      applyNewSP(newGrid);
      setGrid(newGrid);
      setP2Sel(null); setPending(null); setP2SAMode(false);
      advanceTurn(newGrid);
    }
  }

  // ── パス確定（トラッシュ完了後） ──────────────────────────────────────────
  function completeTrashPass(trashCardId: string | null) {
    const isP1 = trashMode === 'p1';
    setTrashMode(null);
    if (isP1) {
      if (trashCardId) setP1Hand(prev => prev.filter(id => id !== trashCardId));
      setP1SPAccum(prev => prev + 1);
      setP1Action('pass');
      setP1Sel(null); setPending(null); setP1SAMode(false);
      setWaitFor('p2');
    } else {
      if (trashCardId) setP2Hand(prev => prev.filter(id => id !== trashCardId));
      setP2SPAccum(prev => prev + 1);
      let newGrid = grid;
      if (p1Action !== 'pass' && p1Action !== null) {
        const card = cardMap.get(p1Action.cardId);
        if (card?.shape) {
          newGrid = placeCard(grid, card.shape, p1Action.x, p1Action.y, 'p1',
            card.specialPos, p1Action.rotation, p1Action.isSA);
        }
      }
      applyNewSP(newGrid);
      setGrid(newGrid);
      setP2Sel(null); setPending(null); setP2SAMode(false);
      advanceTurn(newGrid);
    }
  }

  // ── CPUターン自動実行 ─────────────────────────────────────────────────────
  useEffect(() => {
    if (waitFor !== 'p2' || !cpuMode || p1Action === null) return;
    setCpuThinking(true);
    const timer = setTimeout(() => {
      const move = computeCpuMove(grid, p2Hand, cardMap, cpuLevel, availP2SP, MAX_TURNS - turn, stageInfo);
      let newGrid = grid;

      if (move !== 'pass') {
        const card = cardMap.get(move.cardId);
        if (card?.shape) {
          // resolveSimultaneous は shape/specialPos を内部で取得するので元のshapeを渡す
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
          // SP加算はapplyNewSPで行う
          setP2Placed(prev => [...prev, { cardId: move.cardId, isSA: move.isSA }]);
          showCpuMsg(`CPU が「${move.cardName}」を配置しました`);
        }
      } else {
        // CPUパス：最も不要なカードを自動トラッシュ＋SP+1
        if (p1Action !== 'pass') {
          const card = cardMap.get(p1Action.cardId);
          if (card?.shape) {
            newGrid = placeCard(grid, card.shape, p1Action.x, p1Action.y, 'p1',
              card.specialPos, p1Action.rotation, p1Action.isSA);
          }
        }
        const trashId = pickCardToTrash(p2Hand, cardMap);
        setP2SPAccum(prev => prev + 1);
        if (trashId) {
          setP2Hand(prev => prev.filter(id => id !== trashId));
          showCpuMsg(`CPU がパスしました（トラッシュ: ${cardMap.get(trashId)?.name ?? '?'}）`);
        } else {
          showCpuMsg('CPU がパスしました');
        }
      }

      const { newHand: nh2, newPile: np2 } = move !== 'pass'
        ? drawCard(move.cardId, p2Hand, p2Pile)
        : { newHand: p2Hand, newPile: p2Pile };

      applyNewSP(newGrid);
      setGrid(newGrid);
      setP2Hand(nh2); setP2Pile(np2);
      setCpuThinking(false);
      advanceTurn(newGrid);
    }, CPU_DELAY);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitFor, cpuMode]);

  // P2手動 確定
  function confirmP2Action() {
    if (waitFor !== 'p2' || cpuMode || !pending || !pending.isValid) return;
    const move = { cardId: pending.cardId, x: pending.x, y: pending.y, rotation: pending.rotation, isSA: pending.isSA };
    const card = cardMap.get(pending.cardId);
    if (pending.isSA && card) {
      setP2SPSpent(s => s + card.spp);
      setP2SACount(n => n + 1);
    }
    // SP加算はapplyNewSPで行う
    setP2Placed(prev => [...prev, { cardId: pending.cardId, isSA: pending.isSA }]);
    const { newHand, newPile } = drawCard(pending.cardId, p2Hand, p2Pile);
    setP2Hand(newHand); setP2Pile(newPile);

    const newGrid = resolveSimultaneous(
      grid,
      p1Action !== 'pass'
        ? { cardId: p1Action!.cardId, x: (p1Action as any).x, y: (p1Action as any).y, rotation: (p1Action as any).rotation, isSpecialAttack: (p1Action as any).isSA }
        : 'pass',
      { cardId: move.cardId, x: move.x, y: move.y, rotation: move.rotation, isSpecialAttack: move.isSA },
      (id) => cardMap.get(id)?.shape ?? null,
      (id) => cardMap.get(id)?.specialPos ?? null,
      (id) => cardMap.get(id)?.size ?? 0
    );
    applyNewSP(newGrid);
    setGrid(newGrid);
    setP2Sel(null); setPending(null); setP2SAMode(false);
    advanceTurn(newGrid);
  }

  function advanceTurn(_currentGrid: CellState[][]) {
    if (turn >= MAX_TURNS) {
      setScreen('result');
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

    // ベースグリッド
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r]?.[c] ?? 'E';
        ctx.fillStyle = CELL_COLOR[cell] ?? '#2a2a2a';
        ctx.fillRect(c*cellSize, r*cellSize, cellSize, cellSize);
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(c*cellSize, r*cellSize, cellSize, cellSize);
      }
    }

    // ホバープレビュー
    const activePlayer = waitFor === 'p1' ? 'p1' : 'p2';
    const activeSel    = activePlayer === 'p1' ? p1Sel : p2Sel;
    const activeRot    = activePlayer === 'p1' ? p1Rot : p2Rot;
    const activeSA     = activePlayer === 'p1' ? p1SAMode : p2SAMode;
    const hoverColor   = activePlayer === 'p1' ? 'rgba(255,140,0,0.4)' : 'rgba(0,80,200,0.4)';
    const invalidColor = 'rgba(200,0,0,0.3)';

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

    // 仮配置ハイライト（有効=通常色 / 無効=赤）
    if (pending) {
      const card = cardMap.get(pending.cardId);
      if (card?.shape) {
        const shape = rotateShape(card.shape, pending.rotation);
        if (pending.isValid) {
          ctx.fillStyle   = pending.player === 'p1' ? 'rgba(255,180,0,0.65)' : 'rgba(0,150,255,0.65)';
          ctx.strokeStyle = pending.player === 'p1' ? '#ffaa00' : '#00aaff';
        } else {
          ctx.fillStyle   = 'rgba(220,40,40,0.55)';
          ctx.strokeStyle = '#ff4444';
        }
        ctx.lineWidth = 2;
        for (let r = 0; r < shape.length; r++)
          for (let c = 0; c < (shape[r]?.length ?? 0); c++)
            if (shape[r][c]) {
              ctx.fillRect((pending.x+c)*cellSize, (pending.y+r)*cellSize, cellSize, cellSize);
              ctx.strokeRect((pending.x+c)*cellSize+1, (pending.y+r)*cellSize+1, cellSize-2, cellSize-2);
            }
      }
    }

    // スタート位置マーカー
    if (stage.p1Start) {
      const [x,y] = stage.p1Start;
      if (grid[y]?.[x] !== 'p1_sp') {
        ctx.strokeStyle = '#FF8C00'; ctx.lineWidth = 2;
        ctx.strokeRect(x*cellSize+1, y*cellSize+1, cellSize-2, cellSize-2);
      }
    }
    if (stage.p2Start) {
      const [x,y] = stage.p2Start;
      if (grid[y]?.[x] !== 'p2_sp') {
        ctx.strokeStyle = '#00AAFF'; ctx.lineWidth = 2;
        ctx.strokeRect(x*cellSize+1, y*cellSize+1, cellSize-2, cellSize-2);
      }
    }
  }, [grid, hover, pending, p1Sel, p2Sel, p1Rot, p2Rot, p1SAMode, p2SAMode,
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
    if (cpuThinking) return;

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
  function renderHandCard(cardId: string, isActive: boolean, isP1: boolean) {
    const card = cardMap.get(cardId);
    const sel  = isP1 ? p1Sel : p2Sel;
    const isSel = sel === cardId;
    const isSA  = isP1 ? p1SAMode : p2SAMode;
    const avSP  = isP1 ? availP1SP : availP2SP;
    const hasPending = pending?.cardId === cardId;

    if (!card) return null;
    const borderCls = hasPending
      ? 'border-yellow-400 bg-yellow-950'
      : isSel && isSA
        ? 'border-red-500 bg-red-950'
        : isSel
          ? (isP1 ? 'border-orange-500 bg-orange-950' : 'border-blue-500 bg-blue-950')
          : (isP1 ? 'border-gray-600 bg-gray-800' : 'border-gray-600 bg-gray-800');

    return (
      <div key={cardId}
        className={`rounded border p-1 transition-all cursor-pointer select-none ${borderCls} ${!isActive ? 'opacity-40 pointer-events-none' : ''}`}
        onClick={() => {
          if (!isActive) return;
          if (isP1) { setP1Sel(isSel ? null : cardId); setP1SAMode(false); setPending(null); }
          else      { setP2Sel(isSel ? null : cardId); setP2SAMode(false); setPending(null); }
        }}
      >
        <div className="flex justify-center mb-0.5">
          <CardShape shape={card.shape} specialPos={card.specialPos} cellSize={3}
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
    const isActive = (isP1 && waitFor === 'p1') || (!isP1 && waitFor === 'p2' && !cpuMode);
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
        {/* SA */}
        {saCard && saCard.spp > 0 && (
          <button onClick={() => setSA(!isSA)} disabled={!saOk || !isActive}
            className={`px-1 py-1 rounded text-xs font-bold ${isSA ? 'bg-red-600 text-white animate-pulse' : saOk && isActive ? 'bg-red-900 text-red-300 border border-red-600' : 'bg-gray-800 text-gray-600 cursor-not-allowed'}`}>
            {isSA ? '★SA中' : `SA(${avSP}/${saCard.spp})`}
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
  // SA が使用可能かどうか（選択中カードに対して）
  const p1SAAvail = p1Sel ? (cardMap.get(p1Sel)?.spp ?? 0) > 0 && availP1SP >= (cardMap.get(p1Sel)?.spp ?? 0) : false;
  const p2SAAvail = p2Sel ? (cardMap.get(p2Sel)?.spp ?? 0) > 0 && availP2SP >= (cardMap.get(p2Sel)?.spp ?? 0) : false;

  const statusBar = (
    <div className="flex-shrink-0 bg-gray-900 border-b border-gray-700">
      {/* ターン・スコア行 */}
      <div className="flex items-center gap-2 px-2 py-0.5">
        <span className="text-xs text-gray-400 font-mono">T{turn}/{MAX_TURNS}</span>
        <span className="text-orange-400 text-xs font-bold">P1:{p1Score}マス</span>
        <span className="text-blue-400 text-xs font-bold">{cpuMode ? 'CPU' : 'P2'}:{p2Score}マス</span>
        <span className="ml-auto flex items-center gap-2 text-xs">
          {cpuThinking
            ? <span className="text-blue-300 animate-pulse">CPU思考中...</span>
            : <span className="text-gray-500">{waitFor === 'p1' ? 'P1のターン' : cpuMode ? '' : 'P2のターン'}</span>
          }
          <button
            onClick={() => setShowExitConfirm(true)}
            className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-gray-300 rounded text-xs"
            style={tap}
          >終了</button>
        </span>
      </div>
      {/* SP行 */}
      <div className="flex items-center gap-3 px-2 py-0.5 border-t border-gray-800">
        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold ${
          p1SAAvail ? 'bg-yellow-900 border border-yellow-500 text-yellow-300 animate-pulse' : 'text-orange-300'
        }`}>
          <span className="text-orange-400">P1</span>
          <span>SP:</span>
          <span className="tabular-nums">{availP1SP}</span>
          {p1SAAvail && <span className="text-yellow-400">★SA可</span>}
        </div>
        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold ${
          p2SAAvail ? 'bg-yellow-900 border border-yellow-500 text-yellow-300 animate-pulse' : 'text-blue-300'
        }`}>
          <span className="text-blue-400">{cpuMode ? 'CPU' : 'P2'}</span>
          <span>SP:</span>
          <span className="tabular-nums">{availP2SP}</span>
          {p2SAAvail && <span className="text-yellow-400">★SA可</span>}
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

  const canvasArea = (
    <div className="flex-1 overflow-auto flex items-start justify-center p-1"
      onMouseLeave={() => setHover(null)}>
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
        {p1Hand.map(id => renderHandCard(id, waitFor === 'p1' && !cpuThinking, true))}
      </div>
      {/* CPUアナウンス（P1手札の下：ステージと重ならない位置） */}
      {cpuMessage && (
        <div className="mt-1.5 px-2 py-1 bg-blue-950 border border-blue-700 rounded text-blue-200 text-xs text-center">
          {cpuMessage}
        </div>
      )}
    </div>
  );

  // P2手札エリア（手動時のみ）
  const p2HandArea = !cpuMode ? (
    <div className="flex-shrink-0 border-t border-gray-700 bg-gray-800 p-1.5">
      <div className="text-xs text-blue-400 font-bold mb-1">
        P2手札（{p2Hand.length}枚）　SP: {availP2SP}
      </div>
      <div className="grid grid-cols-4 gap-1">
        {p2Hand.map(id => renderHandCard(id, waitFor === 'p2' && !cpuThinking, false))}
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

  // ── 対戦画面レイアウト ────────────────────────────────────────────────────
  if (screen === 'setup')  return setupScreen;
  if (screen === 'result') return resultScreen;

  // landscape
  if (isLandscape) {
    return (
      <div className="flex flex-row overflow-hidden" style={{ height: '100%', position: 'relative' }}>
        {trashOverlay}
        {exitConfirmEl}
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
      {trashOverlay}
      {exitConfirmEl}
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
