import { useState, useRef, useEffect, useMemo } from 'react';
import { playCardPlace, playSAPlace, playPass, playReset, playSPGain, playCollision } from '../../utils/sounds';
import { useStore, isSampleDeck } from '../../store';
import type { Card, CellState, PlaceAction, Stage, TurnRecord } from '../../types';
import { rotateShape, getShapeBounds } from '../../utils/cardShape';
import { canPlace, countCells, getActivatedSPPositions, hasAnyValidPlacement, resolveSimultaneous } from '../../utils/boardLogic';
import { CardShape } from '../common/CardShape';
import stagesData from '../../data/stages.json';
import { IS_TOUCH, useIsLandscape } from '../../hooks/useIsLandscape';

const STAGES = stagesData as Stage[];

function generateId(): string {
  try { return crypto.randomUUID(); } catch {}
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ─── Grid compression ─────────────────────────────────────────────────────────
// Each cell is encoded as 1 ASCII char; grid is stored as "${rows}|${cols}|${flat}"
const CELL_ENC: Record<CellState, string> = {
  E: '0', W: 'W', B: 'B', p1: '1', p2: '2',
  p1_sp: 'a', p2_sp: 'b', blocked: 'x',
};
const CELL_DEC: Record<string, CellState> = Object.fromEntries(
  Object.entries(CELL_ENC).map(([k, v]) => [v, k as CellState])
);

function encodeGrid(grid: CellState[][]): string {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  return `${rows}|${cols}|${grid.flat().map(c => CELL_ENC[c] ?? '0').join('')}`;
}

function decodeGrid(s: string): CellState[][] {
  const parts = s.split('|');
  const rows = parseInt(parts[0], 10);
  const cols = parseInt(parts[1], 10);
  const flat = parts[2] ?? '';
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => CELL_DEC[flat[r * cols + c] ?? '0'] ?? 'E')
  );
}

// ─── Persistence ──────────────────────────────────────────────────────────────
const BOARD_SAVE_KEY = 'nawabattler_boardsim_v1';
const SAVE_VERSION   = 1;

interface BoardSave {
  v: number;
  stageId: string;
  p1DeckId: string | null;
  p2DeckId: string | null;
  p2Enabled: boolean;
  freePlacement: boolean;
  gameOver: boolean;
  p1DeckCardIds?: string[];
  p2DeckCardIds?: string[];
  gs: {
    grid: string;
    turn: number;
    p1Hand: string[];
    p2Hand: string[];
    p1Deck: string[];
    p2Deck: string[];
    p1SP: number;
    p2SP: number;
    p1SpentSP: number;
    p2SpentSP: number;
    history: Array<{
      turn: number;
      p1Action: PlaceAction | 'pass';
      p2Action: PlaceAction | 'pass';
      gridSnapshot: string;
      p1SP: number;
      p2SP: number;
      p1SpentSP: number;
      p2SpentSP: number;
    }>;
  } | null;
}

function loadBoardSave(): BoardSave | null {
  try {
    const raw = localStorage.getItem(BOARD_SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as BoardSave;
    if (data.v !== SAVE_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

const CELL_COLORS: Record<CellState, string> = {
  E: '#1a3a1a',
  W: '#333333',
  B: '#555555',
  p1: '#FFE000',
  p2: '#0044FF',
  p1_sp: '#FF4500',
  p2_sp: '#00CCFF',
  blocked: '#999999',
};

type Rotation = 0 | 90 | 180 | 270;

interface BoardSimState {
  grid: CellState[][];
  p1Deck: string[];
  p2Deck: string[];
  p1Hand: string[];
  p2Hand: string[];
  p1SP: number;
  p2SP: number;
  p1SpentSP: number;
  p2SpentSP: number;
  turn: number;
  history: TurnRecord[];
}

export function BoardSim() {
  const { cards, decks, folders, p1DeckId, p2DeckId, setP1DeckId, setP2DeckId } = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const isLandscape = useIsLandscape();

  const [stageId, setStageId] = useState<string>(() => {
    const s = loadBoardSave();
    const id = s?.stageId ?? STAGES[0].id;
    return STAGES.find(x => x.id === id) ? id : STAGES[0].id;
  });
  const [cellSize, setCellSize] = useState(12);
  const [gameState, setGameState] = useState<BoardSimState | null>(() => {
    try {
      const s = loadBoardSave();
      if (!s?.gs) return null;
      const { gs } = s;
      return {
        ...gs,
        grid: decodeGrid(gs.grid),
        history: gs.history.map(h => ({ ...h, gridSnapshot: decodeGrid(h.gridSnapshot) })),
      };
    } catch { return null; }
  });
  const [gameOver, setGameOver] = useState<boolean>(() => loadBoardSave()?.gameOver ?? false);

  const [p1SelectedCard, setP1SelectedCard] = useState<string | null>(null);
  const [p2SelectedCard, setP2SelectedCard] = useState<string | null>(null);
  const [p1Rotation, setP1Rotation] = useState<Rotation>(0);
  const [p2Rotation, setP2Rotation] = useState<Rotation>(0);
  const [p1Action, setP1Action] = useState<PlaceAction | 'pass' | null>(null);
  const [p2Action, setP2Action] = useState<PlaceAction | 'pass' | null>(null);
  const [activePlayer, setActivePlayer] = useState<'p1' | 'p2'>('p1');
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [p1SAMode, setP1SAMode] = useState(false);
  const [p2SAMode, setP2SAMode] = useState(false);
  const [p2Enabled, setP2Enabled] = useState<boolean>(() => loadBoardSave()?.p2Enabled ?? false);
  const [freePlacement, setFreePlacement] = useState<boolean>(() => loadBoardSave()?.freePlacement ?? false);
  // Card IDs that belong to the selected deck (for visual grouping in hand)
  const [p1DeckCardIds, setP1DeckCardIds] = useState<string[]>(() => loadBoardSave()?.p1DeckCardIds ?? []);
  const [p2DeckCardIds, setP2DeckCardIds] = useState<string[]>(() => loadBoardSave()?.p2DeckCardIds ?? []);
  const [showPanel, setShowPanel] = useState(false);
  // 横画面の設定エリア（初期は非表示）
  const [showLandscapeSettings, setShowLandscapeSettings] = useState(false);
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null);
  const prevAvailSPRef = useRef<{ p1: number; p2: number }>({ p1: 0, p2: 0 });
  const didRestoreDeckRef = useRef(false);

  // Restore deck selections from localStorage (one-time on mount)
  useEffect(() => {
    if (didRestoreDeckRef.current) return;
    didRestoreDeckRef.current = true;
    const s = loadBoardSave();
    if (!s) return;
    if (s.p1DeckId !== undefined) setP1DeckId(s.p1DeckId);
    if (s.p2DeckId !== undefined) setP2DeckId(s.p2DeckId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist game state whenever it changes
  useEffect(() => {
    try {
      const save: BoardSave = {
        v: SAVE_VERSION,
        stageId,
        p1DeckId,
        p2DeckId,
        p2Enabled,
        freePlacement,
        gameOver,
        p1DeckCardIds,
        p2DeckCardIds,
        gs: gameState ? {
          ...gameState,
          grid: encodeGrid(gameState.grid),
          history: gameState.history.map(h => ({
            ...h,
            gridSnapshot: encodeGrid(h.gridSnapshot),
          })),
        } : null,
      };
      localStorage.setItem(BOARD_SAVE_KEY, JSON.stringify(save));
    } catch (e) {
      console.warn('BoardSim: save failed', e);
    }
  }, [stageId, p1DeckId, p2DeckId, p2Enabled, freePlacement, gameOver, gameState, p1DeckCardIds, p2DeckCardIds]);

  // 横画面になったら設定パネルを自動で閉じる
  useEffect(() => {
    if (isLandscape) setShowPanel(false);
  }, [isLandscape]);

  // Deck group filter for 2-step deck selection (folder-aware)
  const [p1GroupFilter, setP1GroupFilter] = useState<string>('');
  const [p2GroupFilter, setP2GroupFilter] = useState<string>('');

  // Task 4: hand sort
  const [handSortKey, setHandSortKey] = useState<'id' | 'size' | 'rarity' | 'name'>('id');
  const [handSortAsc, setHandSortAsc] = useState(true);
  // Task 6: deck-from-placed modal
  const [showDeckModal, setShowDeckModal] = useState(false);
  const [deckModalSelected, setDeckModalSelected] = useState<Set<string>>(new Set());
  const [deckModalName, setDeckModalName] = useState('配置デッキ');

  interface PendingPlacement {
    cardId: string;
    x: number;
    y: number;
    pivotX: number;  // floating-point center of filled area in grid coords
    pivotY: number;
    rotation: Rotation;
    isSA: boolean;
    player: 'p1' | 'p2';
  }
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);

  const stage = STAGES.find(s => s.id === stageId) ?? STAGES[0];
  const cardMap = new Map(cards.map(c => [c.id, c]));

  function getCard(id: string): Card | undefined { return cardMap.get(id); }

  // Valid placement maps: computed once per grid change, keyed by cardId
  const validPlacementP1 = useMemo(() => {
    const map = new Map<string, { normal: boolean; sa: boolean }>();
    if (!gameState) return map;
    for (const id of gameState.p1Hand) {
      const card = cardMap.get(id);
      if (!card?.shape) { map.set(id, { normal: false, sa: false }); continue; }
      map.set(id, {
        normal: hasAnyValidPlacement(gameState.grid, card.shape, 'p1', false, freePlacement),
        sa: card.spp > 0 ? hasAnyValidPlacement(gameState.grid, card.shape, 'p1', true, freePlacement) : false,
      });
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, freePlacement]);

  const validPlacementP2 = useMemo(() => {
    const map = new Map<string, { normal: boolean; sa: boolean }>();
    if (!gameState || !p2Enabled) return map;
    for (const id of gameState.p2Hand) {
      const card = cardMap.get(id);
      if (!card?.shape) { map.set(id, { normal: false, sa: false }); continue; }
      map.set(id, {
        normal: hasAnyValidPlacement(gameState.grid, card.shape, 'p2', false, freePlacement),
        sa: card.spp > 0 ? hasAnyValidPlacement(gameState.grid, card.shape, 'p2', true, freePlacement) : false,
      });
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, p2Enabled, freePlacement]);

  function startGame() {
    const p1DeckData = decks.find(d => d.id === p1DeckId);
    const p2DeckData = p2Enabled ? decks.find(d => d.id === p2DeckId) : null;

    // Hand always contains all cards; deck card IDs are tracked separately for visual grouping
    const allCardIds = cards.map(c => c.id);
    const p1DeckIds = p1DeckData ? [...p1DeckData.cardIds] : [];
    const p2DeckIds = p2Enabled && p2DeckData ? [...p2DeckData.cardIds] : [];
    setP1DeckCardIds(p1DeckIds);
    setP2DeckCardIds(p2DeckIds);
    const p1HandIds = allCardIds;
    const p2HandIds = p2Enabled ? allCardIds : [];

    const grid = stage.initialGrid.map(row => [...row] as CellState[]);

    setGameState({
      grid,
      p1Deck: [],
      p2Deck: [],
      p1Hand: p1HandIds,
      p2Hand: p2HandIds,
      p1SP: 0,
      p2SP: 0,
      p1SpentSP: 0,
      p2SpentSP: 0,
      turn: 1,
      history: [],
    });
    setGameOver(false);
    setP1SelectedCard(null);
    setP2SelectedCard(null);
    setP1Action(null);
    setP2Action(null);
    setP1SAMode(false);
    setP2SAMode(false);
    setActivePlayer('p1');
  }

  function resetGame() {
    playReset();
    setGameState(null);
    setGameOver(false);
    setP1Action(null);
    setP2Action(null);
    setP1SAMode(false);
    setP2SAMode(false);
    setActivePlayer('p1');
    setP1DeckCardIds([]);
    setP2DeckCardIds([]);
    prevAvailSPRef.current = { p1: 0, p2: 0 };
  }

  function undo() {
    if (!gameState || gameState.history.length === 0) return;
    const prev = gameState.history[gameState.history.length - 1];
    setGameState({
      ...gameState,
      grid: prev.gridSnapshot,
      p1SP: prev.p1SP,
      p2SP: prev.p2SP,
      p1SpentSP: prev.p1SpentSP,
      p2SpentSP: prev.p2SpentSP,
      turn: prev.turn,
      history: gameState.history.slice(0, -1),
    });
    setP1Action(null);
    setP2Action(null);
    setP1SAMode(false);
    setP2SAMode(false);
    setGameOver(false);
  }

  function confirmTurn(p1A: PlaceAction | 'pass', p2A: PlaceAction | 'pass') {
    if (!gameState) return;

    const snapshot = gameState.grid.map(r => [...r] as CellState[]);
    const newGrid = resolveSimultaneous(
      gameState.grid,
      p1A,
      p2A,
      (id) => getCard(id)?.shape ?? null,
      (id) => getCard(id)?.specialPos,
      (id) => getCard(id)?.size ?? 0
    );

    // Collision sound: new 'blocked' cells appeared
    const prevBlocked = gameState.grid.flat().filter(c => c === 'blocked').length;
    const newBlocked  = newGrid.flat().filter(c => c === 'blocked').length;
    if (newBlocked > prevBlocked) playCollision();

    // Hands are fixed (all deck cards always available); only SP changes per turn
    const p1Hand = gameState.p1Hand;
    const p2Hand = gameState.p2Hand;
    const p1Deck = gameState.p1Deck;
    const p2Deck = gameState.p2Deck;
    let p1SP = gameState.p1SP;
    let p2SP = gameState.p2SP;
    let p1SpentSP = gameState.p1SpentSP;
    let p2SpentSP = gameState.p2SpentSP;

    let spGained = false;
    if (p1A === 'pass') {
      p1SP = Math.min(p1SP + 1, 99);
      spGained = true;
    } else {
      if (p1A.isSpecialAttack) p1SpentSP += getCard(p1A.cardId)?.spp ?? 0;
    }

    if (p2A === 'pass') {
      p2SP = Math.min(p2SP + 1, 99);
      spGained = true;
    } else {
      if (p2A.isSpecialAttack) p2SpentSP += getCard(p2A.cardId)?.spp ?? 0;
    }

    // SP squares newly activated on the board?
    const newActSP = getActivatedSPPositions(newGrid);
    const prevActSP = activatedSPPos;
    if (
      (newActSP.p1.length > (prevActSP?.p1.length ?? 0)) ||
      (newActSP.p2.length > (prevActSP?.p2.length ?? 0))
    ) {
      spGained = true;
    }
    if (spGained) playSPGain();

    const record: TurnRecord = {
      turn: gameState.turn,
      p1Action: p1A,
      p2Action: p2A,
      gridSnapshot: snapshot,
      p1SP: gameState.p1SP,
      p2SP: gameState.p2SP,
      p1SpentSP: gameState.p1SpentSP,
      p2SpentSP: gameState.p2SpentSP,
    };

    const newTurn = gameState.turn + 1;
    const isOver = p2Enabled && newTurn > 12;

    setGameState({
      grid: newGrid, p1Deck, p2Deck, p1Hand, p2Hand,
      p1SP, p2SP, p1SpentSP, p2SpentSP,
      turn: newTurn,
      history: [...gameState.history, record],
    });
    setP1Action(null);
    setP2Action(null);
    setP1SelectedCard(null);
    setP2SelectedCard(null);
    setP1SAMode(false);
    setP2SAMode(false);
    setActivePlayer('p1');
    if (isOver) setGameOver(true);
  }

  function handleConfirm() {
    if (p1Action === null || p2Action === null) return;
    confirmTurn(p1Action, p2Action);
  }

  function handleP1Pass() {
    playPass();
    if (!p2Enabled) {
      confirmTurn('pass', 'pass');
    } else {
      setP1Action('pass');
      setActivePlayer('p2');
    }
  }

  function handleP2Pass() {
    playPass();
    // P1がすでに行動済みなら即時ターン確定
    if (p1Action !== null) {
      confirmTurn(p1Action, 'pass');
    } else {
      setP2Action('pass');
      setActivePlayer('p1');
    }
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!gameState || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const gx = Math.floor(mx / cellSize);
    const gy = Math.floor(my / cellSize);

    const player = activePlayer;
    const selectedCard = player === 'p1' ? p1SelectedCard : p2SelectedCard;
    const rotation = player === 'p1' ? p1Rotation : p2Rotation;

    if (!selectedCard) return;
    const card = getCard(selectedCard);
    if (!card?.shape) return;

    const isSA = player === 'p1' ? p1SAMode : p2SAMode;
    const rotated = rotateShape(card.shape, rotation);
    const bounds = getShapeBounds(rotated);
    const ax = gx - (isFinite(bounds.minC) ? bounds.minC : 0);
    const ay = gy - (isFinite(bounds.minR) ? bounds.minR : 0);
    if (!canPlace(gameState.grid, rotated, ax, ay, player, isSA, freePlacement)) return;

    // Set pending placement (same flow as touch) — confirm via 配置確定 button
    const pivotX = ax + (bounds.minC + bounds.maxC) / 2;
    const pivotY = ay + (bounds.minR + bounds.maxR) / 2;
    setPendingPlacement({ cardId: selectedCard, x: ax, y: ay, pivotX, pivotY, rotation, isSA, player });
  }

  function handleCanvasMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const gx = Math.floor((e.clientX - rect.left) / cellSize);
    const gy = Math.floor((e.clientY - rect.top) / cellSize);
    setHoverPos({ x: gx, y: gy });
  }

  function handleCanvasTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!canvasRef.current) return;
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    const gx = Math.floor((touch.clientX - rect.left) / cellSize);
    const gy = Math.floor((touch.clientY - rect.top) / cellSize);
    lastTouchRef.current = { x: gx, y: gy };
    setHoverPos({ x: gx, y: gy });
  }

  function handleCanvasTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!canvasRef.current) return;
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    const gx = Math.floor((touch.clientX - rect.left) / cellSize);
    const gy = Math.floor((touch.clientY - rect.top) / cellSize);
    lastTouchRef.current = { x: gx, y: gy };
    setHoverPos({ x: gx, y: gy });
  }

  function handleCanvasTouchEnd(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!lastTouchRef.current || !gameState) return;
    const { x: gx, y: gy } = lastTouchRef.current;
    lastTouchRef.current = null;
    setHoverPos(null);

    const player = activePlayer;
    const selectedCard = player === 'p1' ? p1SelectedCard : p2SelectedCard;
    const rotation = player === 'p1' ? p1Rotation : p2Rotation;
    if (!selectedCard) return;
    const card = getCard(selectedCard);
    if (!card?.shape) return;
    const isSA = player === 'p1' ? p1SAMode : p2SAMode;
    const rotated = rotateShape(card.shape, rotation);
    const bounds = getShapeBounds(rotated);
    const ax = gx - (isFinite(bounds.minC) ? bounds.minC : 0);
    const ay = gy - (isFinite(bounds.minR) ? bounds.minR : 0);
    // Show pending confirmation overlay (don't place immediately)
    const pivotX = ax + (bounds.minC + bounds.maxC) / 2;
    const pivotY = ay + (bounds.minR + bounds.maxR) / 2;
    setPendingPlacement({ cardId: selectedCard, x: ax, y: ay, pivotX, pivotY, rotation, isSA, player });
  }

  function confirmPendingPlacement() {
    if (!pendingPlacement || !gameState) return;
    const { cardId, x, y, rotation, isSA, player } = pendingPlacement;
    const card = getCard(cardId);
    if (!card?.shape) { setPendingPlacement(null); return; }
    const rotated = rotateShape(card.shape, rotation);
    if (!canPlace(gameState.grid, rotated, x, y, player, isSA, freePlacement)) { setPendingPlacement(null); return; }
    isSA ? playSAPlace() : playCardPlace();
    const action: PlaceAction = { cardId, x, y, rotation, isSpecialAttack: isSA };
    setPendingPlacement(null);
    if (player === 'p1') {
      setP1SAMode(false);
      if (!p2Enabled) {
        confirmTurn(action, 'pass');
      } else {
        setP1Action(action);
        setActivePlayer('p2');
      }
    } else {
      setP2SAMode(false);
      // P2配置確定時: P1がすでに行動済みなら即時ターン確定
      if (p1Action !== null) {
        confirmTurn(p1Action, action);
      } else {
        // P2が先に配置した場合（フリー操作）はP2アクションを記録してP1待ち
        setP2Action(action);
        setActivePlayer('p1');
      }
    }
  }

  function adjustPending(dx: number, dy: number) {
    if (!pendingPlacement) return;
    setPendingPlacement(p => p ? { ...p, x: p.x + dx, y: p.y + dy, pivotX: p.pivotX + dx, pivotY: p.pivotY + dy } : null);
  }

  function rotatePending(dir: 1 | -1) {
    if (!pendingPlacement) return;
    setPendingPlacement(p => {
      if (!p) return null;
      const newRot = ((p.rotation + dir * 90 + 360) % 360) as Rotation;
      const card = getCard(p.cardId);
      if (!card?.shape) return { ...p, rotation: newRot };
      const newRotated = rotateShape(card.shape, newRot);
      const newB = getShapeBounds(newRotated);
      // Anchor so that the fill-area center stays fixed at stored pivotX/Y
      const newX = Math.round(p.pivotX - (newB.minC + newB.maxC) / 2);
      const newY = Math.round(p.pivotY - (newB.minR + newB.maxR) / 2);
      return { ...p, rotation: newRot, x: newX, y: newY };
    });
    // Sync rotation state so hover preview matches
    if (pendingPlacement.player === 'p1') setP1Rotation(r => ((r + dir * 90 + 360) % 360) as Rotation);
    else setP2Rotation(r => ((r + dir * 90 + 360) % 360) as Rotation);
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'x' || e.key === 'X') {
        if (activePlayer === 'p1') setP1Rotation(r => ((r + 90) % 360) as Rotation);
        else setP2Rotation(r => ((r + 90) % 360) as Rotation);
      }
      if (e.key === 'y' || e.key === 'Y') {
        if (activePlayer === 'p1') setP1Rotation(r => ((r + 270) % 360) as Rotation);
        else setP2Rotation(r => ((r + 270) % 360) as Rotation);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [activePlayer]);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !gameState) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const grid = gameState.grid;
    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;

    canvas.width = cols * cellSize;
    canvas.height = rows * cellSize;

    // Draw base grid
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c];
        ctx.fillStyle = CELL_COLORS[cell];
        ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
        // No grid lines on wall cells — but DO draw lines on SP cells to show cell boundaries
        if (cell !== 'W') {
          ctx.strokeStyle = '#111';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(c * cellSize, r * cellSize, cellSize, cellSize);
        }
      }
    }

    // Draw hover preview (use pendingPlacement if active, else hoverPos)
    const player = activePlayer;
    const selectedCard = player === 'p1' ? p1SelectedCard : p2SelectedCard;
    const rotation = player === 'p1' ? p1Rotation : p2Rotation;

    const previewPos = pendingPlacement
      ? { x: pendingPlacement.x, y: pendingPlacement.y }
      : hoverPos;
    const previewCard = pendingPlacement ? pendingPlacement.cardId : selectedCard;
    const previewRotation = pendingPlacement ? pendingPlacement.rotation : rotation;
    const previewPlayer = pendingPlacement ? pendingPlacement.player : player;
    const previewSA = pendingPlacement ? pendingPlacement.isSA : (player === 'p1' ? p1SAMode : p2SAMode);

    if (previewPos && previewCard) {
      const card = getCard(previewCard);
      if (card?.shape) {
        const origRows = card.shape.length;
        const origCols = card.shape[0]?.length ?? 0;
        const rotated = rotateShape(card.shape, previewRotation);
        const bounds = getShapeBounds(rotated);
        // If pendingPlacement, x/y are already the anchor; for hover, subtract min bounds
        const offC = pendingPlacement ? 0 : (isFinite(bounds.minC) ? bounds.minC : 0);
        const offR = pendingPlacement ? 0 : (isFinite(bounds.minR) ? bounds.minR : 0);
        const ax = previewPos.x - offC;
        const ay = previewPos.y - offR;
        const isSA = previewSA;
        const color = isSA
          ? (previewPlayer === 'p1' ? 'rgba(220,50,50,0.55)' : 'rgba(160,50,220,0.55)')
          : (previewPlayer === 'p1' ? 'rgba(255,140,0,0.5)' : 'rgba(0,170,255,0.5)');
        const spColor = isSA
          ? (previewPlayer === 'p1' ? 'rgba(255,80,0,0.8)' : 'rgba(200,0,255,0.8)')
          : (previewPlayer === 'p1' ? 'rgba(255,69,0,0.7)' : 'rgba(0,204,255,0.7)');
        const invalid = !canPlace(grid, rotated, ax, ay, previewPlayer, isSA, freePlacement);

        // Compute rotated SP position
        let rSP: [number, number] | null = null;
        if (card.specialPos) {
          const [sr, sc] = card.specialPos;
          switch (previewRotation) {
            case 0:   rSP = [sr, sc]; break;
            case 90:  rSP = [sc, origRows - 1 - sr]; break;
            case 180: rSP = [origRows - 1 - sr, origCols - 1 - sc]; break;
            case 270: rSP = [origCols - 1 - sc, sr]; break;
          }
        }

        for (let r = 0; r < rotated.length; r++) {
          for (let c = 0; c < rotated[r].length; c++) {
            if (!rotated[r][c]) continue;
            const gx = ax + c;
            const gy = ay + r;
            if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
            const isSP = rSP && rSP[0] === r && rSP[1] === c;
            ctx.fillStyle = invalid ? 'rgba(255,0,0,0.4)' : (isSP ? spColor : color);
            ctx.fillRect(gx * cellSize, gy * cellSize, cellSize, cellSize);
          }
        }
      }
    }

    // Draw start positions (skip when the cell is already an SP cell — all stages place start
    // positions on top of initial SP cells, and drawing a stroke there would override the
    // no-stroke SP rendering done in the base grid loop above)
    if (stage.p1Start) {
      const [x, y] = stage.p1Start;
      if (grid[y]?.[x] !== 'p1_sp') {
        ctx.strokeStyle = '#FF8C00';
        ctx.lineWidth = 2;
        ctx.strokeRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, cellSize - 2);
      }
    }
    if (stage.p2Start) {
      const [x, y] = stage.p2Start;
      if (grid[y]?.[x] !== 'p2_sp') {
        ctx.strokeStyle = '#00AAFF';
        ctx.lineWidth = 2;
        ctx.strokeRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, cellSize - 2);
      }
    }
  }, [gameState, hoverPos, p1SelectedCard, p2SelectedCard, p1Rotation, p2Rotation, activePlayer, cellSize, stage, p1SAMode, p2SAMode, pendingPlacement, freePlacement]);

  const counts = gameState ? countCells(gameState.grid) : null;
  // アクティベートされた SP セル（SP カウント用）
  const activatedSPPos = gameState ? getActivatedSPPositions(gameState.grid) : null;
  const activatedSP = activatedSPPos ? { p1: activatedSPPos.p1.length, p2: activatedSPPos.p2.length } : null;
  // availableSP = board-activated SP + pass-bonus SP − spent SP
  const availableSP = {
    p1: Math.max(0, (activatedSP?.p1 ?? 0) + (gameState?.p1SP ?? 0) - (gameState?.p1SpentSP ?? 0)),
    p2: Math.max(0, (activatedSP?.p2 ?? 0) + (gameState?.p2SP ?? 0) - (gameState?.p2SpentSP ?? 0)),
  };

  // Tasks 2, 3, 6: derive placed card IDs (and ordered list) from history
  const placedP1: { cardId: string; turn: number; isSA: boolean }[] =
    gameState?.history.filter(r => r.p1Action !== 'pass').map(r => ({
      cardId: (r.p1Action as PlaceAction).cardId,
      turn: r.turn,
      isSA: (r.p1Action as PlaceAction).isSpecialAttack,
    })) ?? [];
  const placedP2: { cardId: string; turn: number; isSA: boolean }[] =
    gameState?.history.filter(r => r.p2Action !== 'pass').map(r => ({
      cardId: (r.p2Action as PlaceAction).cardId,
      turn: r.turn,
      isSA: (r.p2Action as PlaceAction).isSpecialAttack,
    })) ?? [];
  const placedP1Ids = new Set(placedP1.map(x => x.cardId));
  const placedP2Ids = new Set(placedP2.map(x => x.cardId));

  const renderHand = (player: 'p1' | 'p2') => {
    const rawHand = player === 'p1' ? gameState?.p1Hand : gameState?.p2Hand;
    const selected = player === 'p1' ? p1SelectedCard : p2SelectedCard;
    const setSelected = player === 'p1' ? setP1SelectedCard : setP2SelectedCard;
    const setSAMode = player === 'p1' ? setP1SAMode : setP2SAMode;
    const action = player === 'p1' ? p1Action : p2Action;
    const isSAMode = player === 'p1' ? p1SAMode : p2SAMode;
    const avSP = player === 'p1' ? availableSP.p1 : availableSP.p2;
    const isActive = activePlayer === player;
    const selectedCard = selected ? getCard(selected) : null;
    const validMap = player === 'p1' ? validPlacementP1 : validPlacementP2;
    const saUnlocked = selectedCard && selected
      ? avSP >= selectedCard.spp && (validMap.get(selected)?.sa ?? true)
      : false;
    const placedIds = player === 'p1' ? placedP1Ids : placedP2Ids;

    // Deck card grouping
    const deckCardSet = new Set(player === 'p1' ? p1DeckCardIds : p2DeckCardIds);
    const hasDeckFilter = deckCardSet.size > 0;

    // Sort function
    const RARITY_ORDER = { fresh: 0, rare: 1, common: 2 };
    const sortFn = (a: string, b: string) => {
      const ca = getCard(a), cb = getCard(b);
      if (!ca || !cb) return 0;
      let cmp = 0;
      if (handSortKey === 'id') cmp = Number(ca.id) - Number(cb.id);
      else if (handSortKey === 'size') { cmp = ca.size - cb.size; if (cmp === 0) cmp = ca.name.localeCompare(cb.name, 'ja'); }
      else if (handSortKey === 'rarity') cmp = (RARITY_ORDER[ca.rarity] ?? 9) - (RARITY_ORDER[cb.rarity] ?? 9);
      else if (handSortKey === 'name') cmp = ca.name.localeCompare(cb.name, 'ja');
      return handSortAsc ? cmp : -cmp;
    };

    // Split into deck cards and others.
    // Deck cards preserve slot order (1-15) as registered; others are sorted by sortFn.
    const allIds = rawHand ?? [];
    const deckCardOrder = player === 'p1' ? p1DeckCardIds : p2DeckCardIds;
    const deckGroupIds  = hasDeckFilter
      ? deckCardOrder.filter(id => allIds.includes(id))   // preserve deck slot order
      : [];
    const otherGroupIds = hasDeckFilter
      ? [...allIds].filter(id => !deckCardSet.has(id)).sort(sortFn)
      : [...allIds].sort(sortFn);

    // Single card button factory
    const makeCardBtn = (id: string, inDeck: boolean) => {
      const card = getCard(id);
      const isSelected = selected === id;
      const isConfirmed = action !== null && action !== 'pass' && action.cardId === id;
      const isPlaced = placedIds.has(id);
      const noValidPlace = isActive && !isPlaced && !(validMap.get(id)?.normal ?? true);
      const disabled = !isActive || isPlaced || noValidPlace;
      return (
        <button
          key={id}
          onClick={() => { if (disabled) return; setSelected(isSelected ? null : id); setSAMode(false); }}
          disabled={disabled}
          title={isPlaced ? '配置済み' : noValidPlace ? '配置できる場所がありません' : undefined}
          className={`p-1 rounded border text-xs transition-all ${
            isPlaced || noValidPlace ? 'border-gray-700 bg-gray-900 opacity-30 cursor-not-allowed' :
            isConfirmed ? 'border-green-500 bg-green-900' :
            isSelected && isSAMode ? 'border-red-500 bg-red-950' :
            isSelected && player === 'p1' ? 'border-orange-500 bg-orange-950' :
            isSelected ? 'border-blue-500 bg-blue-950' :
            inDeck
              ? (player === 'p1' ? 'border-yellow-700/60 bg-gray-800 hover:border-yellow-500' : 'border-blue-700/60 bg-gray-800 hover:border-blue-400')
              : 'border-gray-600 bg-gray-800 hover:border-gray-400'
          }`}
        >
          {card ? (
            <div>
              <CardShape shape={card.shape} specialPos={card.specialPos} cellSize={3}
                p1Color={player === 'p1' ? '#FFE000' : '#0044FF'}
                spColor={player === 'p1' ? '#FF4500' : '#00CCFF'} />
              <div className="text-gray-400 mt-0.5 truncate w-10 leading-tight" style={{ fontSize: '9px' }}>{card.name}</div>
              <div className="text-gray-600" style={{ fontSize: '9px' }}>{card.size}m{card.spp > 0 ? ` S${card.spp}` : ''}</div>
            </div>
          ) : <span className="text-gray-600">?</span>}
        </button>
      );
    };

    const borderClass = isSAMode
      ? 'border-red-500 shadow-red-500/40 shadow-md'
      : isActive
        ? (player === 'p1' ? 'border-orange-500' : 'border-blue-500')
        : 'border-gray-700';

    return (
      <div className={`p-2 border rounded bg-gray-900 transition-all flex flex-col min-h-0 ${borderClass}`}>
        {/* Header: player label, SP, sort buttons */}
        <div className="flex items-center gap-1 mb-1.5 flex-wrap flex-shrink-0">
          <span className={`font-bold text-sm shrink-0 ${isSAMode ? 'text-red-400' : player === 'p1' ? 'text-orange-400' : 'text-blue-400'}`}>
            P{player === 'p1' ? '1' : '2'}{isSAMode ? '【SA】' : isActive ? '(操作中)' : ''}
          </span>
          <span className="text-xs text-gray-400 shrink-0">
            SP:<span className={avSP > 0 ? 'text-yellow-300 font-bold' : 'text-gray-500'}>{avSP}</span>
          </span>
          {/* sort buttons */}
          <div className="flex gap-0.5 ml-auto flex-wrap justify-end">
            {([
              { key: 'id',     label: '番号' },
              { key: 'size',   label: 'マス数' },
              { key: 'rarity', label: 'レア' },
              { key: 'name',   label: '名前' },
            ] as { key: 'id' | 'size' | 'rarity' | 'name'; label: string }[]).map(({ key, label }) => (
              <button key={key}
                onClick={() => { if (handSortKey === key) setHandSortAsc(v => !v); else { setHandSortKey(key); setHandSortAsc(true); } }}
                className={`px-1 py-0.5 rounded text-xs border transition-colors ${
                  handSortKey === key
                    ? 'bg-gray-600 border-gray-400 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500'
                }`}
              >
                {label}{handSortKey === key ? (handSortAsc ? '↑' : '↓') : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Card grid — deck cards first (slot order), then all others (sorted) */}
        <div className="flex flex-wrap gap-1 mb-1 flex-1 min-h-0 overflow-y-auto" style={{ alignContent: 'flex-start' }}>
          {hasDeckFilter && (
            <div className="w-full text-xs font-bold pb-0.5" style={{ color: player === 'p1' ? '#d97706' : '#3b82f6' }}>
              ▶ デッキ（{deckGroupIds.length}枚）
            </div>
          )}
          {deckGroupIds.map(id => makeCardBtn(id, true))}
          {hasDeckFilter && (
            <div className="w-full border-t border-gray-700 pt-1 mt-0.5 text-xs text-gray-500">
              全カード（{otherGroupIds.length}枚）
            </div>
          )}
          {otherGroupIds.map(id => makeCardBtn(id, false))}
        </div>

        {/* Action row - SA only (pass/rotate moved to controls column) */}
        {isActive && action === null && selected && (selectedCard?.spp ?? 0) > 0 && (
          <div className="flex gap-1 flex-wrap mt-1 flex-shrink-0">
            <button onClick={() => setSAMode(!isSAMode)} disabled={!saUnlocked}
              className={`px-2 py-1 rounded text-xs font-bold transition-all ${
                isSAMode ? 'bg-red-600 text-white ring-2 ring-red-400 animate-pulse' :
                saUnlocked ? 'bg-red-900 text-red-300 hover:bg-red-700 border border-red-600' :
                'bg-gray-800 text-gray-600 border border-gray-700 cursor-not-allowed'
              }`}
              title={saUnlocked ? `SA発動（SP${selectedCard?.spp}消費）` : `SP不足(必要:${selectedCard?.spp} 現在:${avSP})`}>
              {isSAMode ? '★SA中' : `SA(${avSP}/${selectedCard?.spp})`}
            </button>
          </div>
        )}
        {action !== null && (
          <div className="text-xs text-green-400 flex-shrink-0">
            {action === 'pass' ? 'パス済' : action.isSpecialAttack ? '★SA配置済' : '配置済'}
          </div>
        )}
      </div>
    );
  };

  // ─── Modal JSX（deck-from-placed modal） ─────────────────────────────────────
  const modalJsx = showDeckModal ? (() => {
    const allPlaced = placedP1.map(x => x.cardId);
    const toggleCard = (id: string) => {
      setDeckModalSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else if (next.size < 15) next.add(id);
        return next;
      });
    };
    const handleSaveDeckModal = () => {
      if (!deckModalName.trim()) return;
      const { saveDeck: save } = useStore.getState();
      save({ id: generateId(), name: deckModalName.trim(), cardIds: [...deckModalSelected], createdAt: Date.now(), updatedAt: Date.now() });
      setShowDeckModal(false);
    };
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
        <div className="bg-gray-900 border border-gray-600 rounded-lg w-full max-w-md max-h-[90vh] flex flex-col">
          <div className="p-3 border-b border-gray-700 flex items-center justify-between">
            <h3 className="text-white font-bold">デッキ作成（{deckModalSelected.size}/15枚選択）</h3>
            <button onClick={() => setShowDeckModal(false)} className="text-gray-400 hover:text-white text-lg">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {allPlaced.length === 0
              ? <div className="text-gray-500 text-sm text-center py-4">配置済みカードがありません</div>
              : allPlaced.map((cardId, i) => {
                const card = getCard(cardId);
                const checked = deckModalSelected.has(cardId);
                const atLimit = !checked && deckModalSelected.size >= 15;
                return (
                  <label key={`${cardId}-${i}`} className={`flex items-center gap-3 px-2 py-1.5 rounded border cursor-pointer transition-colors ${
                    checked ? 'border-orange-500 bg-orange-950' : atLimit ? 'border-gray-700 bg-gray-900 opacity-50 cursor-not-allowed' : 'border-gray-700 bg-gray-800 hover:border-gray-500'
                  }`}>
                    <input type="checkbox" checked={checked} disabled={atLimit} onChange={() => toggleCard(cardId)} className="accent-orange-500" />
                    {card ? (
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <CardShape shape={card.shape} specialPos={card.specialPos} cellSize={5} />
                        <div className="flex-1 min-w-0">
                          <div className="text-white text-sm truncate">{card.name}</div>
                          <div className="text-gray-500 text-xs">{card.size}マス{card.spp > 0 ? ` SP${card.spp}` : ''}</div>
                        </div>
                      </div>
                    ) : <span className="text-gray-500 text-sm">{cardId}</span>}
                  </label>
                );
              })
            }
          </div>
          <div className="p-3 border-t border-gray-700 space-y-2">
            <input type="text" value={deckModalName} onChange={e => setDeckModalName(e.target.value)} placeholder="デッキ名"
              className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-white" />
            <div className="flex gap-2">
              <button onClick={handleSaveDeckModal} disabled={deckModalSelected.size === 0 || !deckModalName.trim()}
                className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded font-bold text-sm">保存</button>
              <button onClick={() => setShowDeckModal(false)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm">キャンセル</button>
            </div>
          </div>
        </div>
      </div>
    );
  })() : null;

  // ─── CSS アニメーション style タグ ───────────────────────────────────────────
  const styleTag = (
    <style>{`
      @keyframes flame-rise-p1 { 0%{background-position:50% 100%} 50%{background-position:50% 0%} 100%{background-position:50% 100%} }
      @keyframes flame-rise-p2 { 0%{background-position:50% 100%} 50%{background-position:50% 0%} 100%{background-position:50% 100%} }
      .flame-p1 { background:linear-gradient(to top,#CC1100,#FF2200,#FF4500,#FF8C00,#FFE000,#FF8C00,#FF4500); background-size:100% 500%; box-shadow:0 0 5px #FF4500; animation:flame-rise-p1 1.4s ease-in-out infinite; }
      .flame-p2 { background:linear-gradient(to top,#001199,#0033CC,#0044FF,#0088FF,#00CCFF,#00FFFF,#00CCFF); background-size:100% 500%; box-shadow:0 0 5px #00CCFF; animation:flame-rise-p2 1.4s ease-in-out infinite; }
      .flame-p1:nth-child(2n){animation-delay:0.2s} .flame-p1:nth-child(3n){animation-delay:0.4s} .flame-p1:nth-child(4n){animation-delay:0.6s}
      .flame-p2:nth-child(2n){animation-delay:0.2s} .flame-p2:nth-child(3n){animation-delay:0.4s} .flame-p2:nth-child(4n){animation-delay:0.6s}
    `}</style>
  );

  // ─── Controls column（portrait / landscape 共用） ────────────────────────────
  function renderControlsColumn(compact = false) {
    if (!gameState || gameOver) return null;
    const hasPending = !!pendingPlacement;
    const activeCard = pendingPlacement
      ? getCard(pendingPlacement.cardId)
      : (activePlayer === 'p1' ? (p1SelectedCard ? getCard(p1SelectedCard) : null) : (p2SelectedCard ? getCard(p2SelectedCard) : null));
    const hasCard = !!activeCard;
    const pendingRotated = pendingPlacement && activeCard?.shape
      ? rotateShape(activeCard.shape, pendingPlacement.rotation) : null;
    const isValid = hasPending && pendingRotated
      ? canPlace(gameState.grid, pendingRotated, pendingPlacement!.x, pendingPlacement!.y, pendingPlacement!.player, pendingPlacement!.isSA, freePlacement)
      : false;
    // compact=true(横画面): w-7 h-7 (28px), compact=false(縦画面): w-9 h-9 (36px, +29%)
    const sz = compact ? 'w-7 h-7' : 'w-9 h-9';
    const btnSq = `${sz} rounded text-sm font-bold transition-colors select-none flex items-center justify-center`;
    const btnActive = `${btnSq} bg-gray-600 active:bg-gray-500 text-white`;
    const btnDim   = `${btnSq} bg-gray-800 text-gray-600 cursor-not-allowed`;
    const activeSel = activePlayer === 'p1' ? p1SelectedCard : p2SelectedCard;
    const activeSAMode = activePlayer === 'p1' ? p1SAMode : p2SAMode;
    const setActiveSAMode = activePlayer === 'p1' ? setP1SAMode : setP2SAMode;
    const activeAvSP = activePlayer === 'p1' ? availableSP.p1 : availableSP.p2;
    const activeSCard = activeSel ? getCard(activeSel) : null;
    const activeValidMap = activePlayer === 'p1' ? validPlacementP1 : validPlacementP2;
    const saOk = (activeSCard?.spp ?? 0) > 0
      && activeAvSP >= (activeSCard?.spp ?? 0)
      && (activeSel ? (activeValidMap.get(activeSel)?.sa ?? true) : false);
    const playerAction = activePlayer === 'p1' ? p1Action : p2Action;
    // w-20(80px): inner 72px = 36px + 36px = 2ボタン横並びにちょうど収まる
    const colW = compact ? 'w-20' : 'w-20';

    // 矢印ボタン: onPointerDown で即レスポンス（タッチ・マウス共通、連打バグなし）
    function makeArrowBtn(dx: number, dy: number, label: string) {
      const handle = () => { if (hasPending) adjustPending(dx, dy); };
      return (
        <button
          key={`${dx}${dy}`}
          disabled={!hasPending}
          className={hasPending ? btnActive : btnDim}
          onPointerDown={e => { e.stopPropagation(); handle(); }}
        >{label}</button>
      );
    }

    const rotateLeft  = () => hasPending ? rotatePending(-1) : (activePlayer==='p1' ? setP1Rotation(r=>((r+270)%360) as Rotation) : setP2Rotation(r=>((r+270)%360) as Rotation));
    const rotateRight = () => hasPending ? rotatePending(1)  : (activePlayer==='p1' ? setP1Rotation(r=>((r+90 )%360) as Rotation) : setP2Rotation(r=>((r+90 )%360) as Rotation));

    return (
      <div className={`${colW} flex-shrink-0 border-l border-gray-700 bg-gray-900 p-1 flex flex-col gap-1 overflow-y-auto`}>
        {/* 十字キー — 縦画面は w-9(36px)ボタン、gap=0 で inner 72px にぴったり収まる */}
        <div className="flex flex-col items-center" style={{ gap: compact ? 0 : 4 }}>
          {makeArrowBtn(0, -1, '↑')}
          <div className="flex" style={{ gap: 0 }}>
            {makeArrowBtn(-1, 0, '←')}
            {makeArrowBtn(1,  0, '→')}
          </div>
          {makeArrowBtn(0, 1, '↓')}
        </div>
        <div className="flex gap-0.5">
          <button disabled={!hasCard}
            onPointerDown={e => { e.stopPropagation(); if (hasCard) rotateLeft(); }}
            className={hasCard?btnActive:btnDim}>↺</button>
          <button disabled={!hasCard}
            onPointerDown={e => { e.stopPropagation(); if (hasCard) rotateRight(); }}
            className={hasCard?btnActive:btnDim}>↻</button>
        </div>
        <button disabled={!isValid} onClick={confirmPendingPlacement}
          className={`px-1 py-1 rounded text-xs font-bold ${isValid?'bg-green-700 hover:bg-green-600 text-white':'bg-gray-800 text-gray-600 cursor-not-allowed'}`}>配置確定</button>
        <button disabled={!hasPending} onClick={() => setPendingPlacement(null)}
          className={`px-1 py-1 rounded text-xs ${hasPending?'bg-gray-600 hover:bg-gray-500 text-white':'bg-gray-800 text-gray-600 cursor-not-allowed'}`}>取消</button>
        {(activeSCard?.spp ?? 0) > 0 && (
          <button onClick={() => setActiveSAMode(!activeSAMode)} disabled={!saOk}
            className={`px-1 py-1 rounded text-xs font-bold ${
              activeSAMode?'bg-red-600 text-white ring-1 ring-red-400 animate-pulse':
              saOk?'bg-red-900 text-red-300 hover:bg-red-700 border border-red-600':
              'bg-gray-800 text-gray-600 border border-gray-700 cursor-not-allowed'}`}>
            {activeSAMode?'★SA中':`SA(${activeAvSP}/${activeSCard?.spp})`}
          </button>
        )}
        <button onClick={activePlayer==='p1'?handleP1Pass:handleP2Pass} disabled={playerAction!==null}
          className={`px-1 py-1 rounded text-xs ${playerAction!==null?'bg-gray-800 text-gray-600 cursor-not-allowed':'bg-gray-700 hover:bg-gray-600 text-white'}`}>パス</button>
      </div>
    );
  }

  // ─── SP overlay （canvas 上の HTML overlay） ─────────────────────────────────
  const spOverlay = activatedSPPos && (
    <div style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
      {activatedSPPos.p1.map(([r,c]) => (
        <div key={`p1sp-${r}-${c}`} className="flame-p1"
          style={{ position:'absolute', left:c*cellSize, top:r*cellSize, width:cellSize, height:cellSize, opacity:0.75 }}/>
      ))}
      {activatedSPPos.p2.map(([r,c]) => (
        <div key={`p2sp-${r}-${c}`} className="flame-p2"
          style={{ position:'absolute', left:c*cellSize, top:r*cellSize, width:cellSize, height:cellSize, opacity:0.75 }}/>
      ))}
    </div>
  );

  // ─── canvas セクション ────────────────────────────────────────────────────────
  const canvasSection = (
    <div ref={canvasContainerRef} className="flex-1 overflow-auto flex items-start justify-center p-1" onMouseLeave={() => setHoverPos(null)}>
      {gameState ? (
        <div style={{ position:'relative', display:'inline-block' }}>
          <canvas ref={canvasRef}
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMouseMove}
            onTouchStart={handleCanvasTouchStart}
            onTouchMove={handleCanvasTouchMove}
            onTouchEnd={handleCanvasTouchEnd}
            className="cursor-crosshair border border-gray-700 touch-none"
            style={{ imageRendering:'pixelated', display:'block' }}/>
          {spOverlay}
        </div>
      ) : (
        <div className="flex items-center justify-center h-full text-gray-600">
          <div className="text-center"><div className="text-4xl mb-4">🎮</div><div>デッキを選択してゲームを開始してください</div></div>
        </div>
      )}
    </div>
  );

  // ─── 2-step deck selection (folder-aware) ────────────────────────────────────
  const userDecks   = decks.filter(d => d.id !== 'all' && !isSampleDeck(d.id));
  const sampleDecks = decks.filter(d => isSampleDeck(d.id));
  const deckFolderMap = new Map<string, string>();
  for (const f of folders) for (const id of f.deckIds) deckFolderMap.set(id, f.id);
  const rootUserDecks = userDecks.filter(d => !deckFolderMap.has(d.id));

  function getDecksForGroup(group: string): typeof decks {
    if (group === 'sample') return sampleDecks;
    if (group === 'root') return rootUserDecks;
    const folder = folders.find(f => f.id === group);
    if (folder) return folder.deckIds.map(id => userDecks.find(d => d.id === id)).filter(Boolean) as typeof decks;
    return [];
  }

  function renderDeckSelect(
    player: 'p1' | 'p2',
    groupFilter: string,
    setGroupFilter: (v: string) => void,
    deckId: string | null,
    setDeckId: (id: string | null) => void,
    compact = false,
  ) {
    const selClass = compact
      ? 'w-full px-1.5 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-white'
      : 'w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white';
    const disabled = !!gameState;

    return (
      <div className={compact ? '' : 'space-y-1'}>
        {/* Step 1: group/folder */}
        <select
          value={groupFilter}
          onChange={e => {
            const g = e.target.value;
            setGroupFilter(g);
            if (g === '') setDeckId(null); // 全カード
          }}
          disabled={disabled}
          className={selClass}
        >
          <option value="">全カード（{cards.length}枚）</option>
          {rootUserDecks.length > 0 && <option value="root">マイデッキ直下</option>}
          {folders.map(f => <option key={f.id} value={f.id}>📁 {f.name}</option>)}
          {sampleDecks.length > 0 && <option value="sample">サンプルデッキ</option>}
        </select>
        {/* Step 2: deck within group */}
        {groupFilter !== '' && (
          <select
            value={deckId ?? ''}
            onChange={e => setDeckId(e.target.value || null)}
            disabled={disabled}
            className={`${selClass} ${compact ? 'mt-0.5' : ''}`}
          >
            <option value="">（デッキを選択）</option>
            {getDecksForGroup(groupFilter).map(d => {
              const rCount = d.reserveCardIds?.length ?? 0;
              const suffix = d.cardIds.length < 15
                ? ` (メイン${d.cardIds.length}/15${rCount > 0 ? ` +予備${rCount}` : ''})`
                : rCount > 0 ? ` (+予備${rCount})` : '';
              return (
                <option key={d.id} value={d.id}>
                  {d.name}{suffix}
                </option>
              );
            })}
          </select>
        )}
      </div>
    );
  }

  // ─── Landscape layout ────────────────────────────────────────────────────────
  if (isLandscape) {
    return (
      <>
      <div className="flex flex-row overflow-hidden" style={{ height: '100%' }}>
        {styleTag}
        {/* LEFT 58%: ステージ(canvas) + コントロール */}
        <div className="flex flex-col overflow-hidden border-r border-gray-700" style={{ width: '58%' }}>
          {/* compact status bar */}
          <div className="flex items-center gap-1 px-1.5 py-0.5 bg-gray-900 border-b border-gray-700 flex-shrink-0 flex-wrap">
            {gameState && <>
              <span className="text-xs text-gray-400 font-mono">T{Math.min(gameState.turn,12)}/12</span>
              {counts && <><span className="text-orange-400 text-xs font-bold">P1:{counts.p1}</span>{p2Enabled&&<span className="text-blue-400 text-xs font-bold">P2:{counts.p2}</span>}</>}
            </>}
            <div className="ml-auto flex gap-0.5">
              <button onClick={undo} disabled={!gameState?.history.length} className="px-1.5 py-0.5 bg-gray-700 disabled:opacity-40 text-white rounded text-xs">↩</button>
              <button onClick={resetGame} className="px-1.5 py-0.5 bg-gray-700 text-white rounded text-xs">RST</button>
            </div>
          </div>
          {gameOver && counts && (
            <div className="p-1 bg-gray-800 border-b border-gray-700 text-center flex-shrink-0">
              <span className="text-white font-bold text-xs mr-2">ゲーム終了</span>
              <span className="text-orange-400 text-xs">P1:{counts.p1}</span>
              <span className="text-gray-400 text-xs mx-1">/</span>
              <span className="text-blue-400 text-xs">P2:{counts.p2}</span>
              <span className="text-yellow-400 text-xs ml-2">{counts.p1>counts.p2?'P1勝利':counts.p2>counts.p1?'P2勝利':'引き分け'}</span>
            </div>
          )}
          {/* canvas + controls */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {canvasSection}
            {renderControlsColumn(true)}
          </div>
        </div>

        {/* RIGHT 42%: 設定（折りたたみ）+ 手札 */}
        <div className="flex flex-col overflow-hidden" style={{ width: '42%' }}>
          {/* 設定ヘッダー行（常時表示の最小コントロール） */}
          <div className="flex-shrink-0 bg-gray-900 border-b border-gray-700 px-2 py-0.5">
            <div className="flex items-center gap-1.5">
              <select value={stageId} onChange={e=>setStageId(e.target.value)} disabled={!!gameState}
                className="flex-1 min-w-0 px-1 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-white">
                {STAGES.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {!gameState
                ? <button onClick={startGame} className="px-2 py-0.5 bg-orange-600 text-white rounded text-xs font-bold shrink-0">開始</button>
                : <button onClick={resetGame} className="px-2 py-0.5 bg-gray-700 text-white rounded text-xs shrink-0">RST</button>}
              <button onClick={() => setShowLandscapeSettings(v => !v)}
                className="px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded text-xs shrink-0">
                {showLandscapeSettings ? '▲' : '▼'}
              </button>
            </div>
          </div>

          {/* 折りたたみ設定エリア */}
          {showLandscapeSettings && (
            <div className="flex-shrink-0 bg-gray-900 border-b border-gray-700 px-2 py-1 overflow-y-auto" style={{ maxHeight: '40%' }}>
              {/* デッキ選択 */}
              <div className="flex gap-1.5 mb-1">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-500 mb-0.5">P1デッキ</div>
                  {renderDeckSelect('p1', p1GroupFilter, setP1GroupFilter, p1DeckId, setP1DeckId, true)}
                </div>
                {p2Enabled && (
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-500 mb-0.5">P2デッキ</div>
                    {renderDeckSelect('p2', p2GroupFilter, setP2GroupFilter, p2DeckId, setP2DeckId, true)}
                  </div>
                )}
              </div>
              {/* トグル */}
              <div className="flex gap-3 items-center text-xs mb-1">
                <label className="flex items-center gap-1 text-gray-400">
                  <button onClick={()=>!gameState&&setP2Enabled(v=>!v)} disabled={!!gameState}
                    className={`relative inline-flex w-7 h-4 rounded-full transition-colors ${p2Enabled?'bg-blue-500':'bg-gray-600'} ${gameState?'opacity-50 cursor-not-allowed':'cursor-pointer'}`}>
                    <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${p2Enabled?'translate-x-3':'translate-x-0.5'}`}/>
                  </button>
                  P2
                </label>
                <label className="flex items-center gap-1 text-gray-400">
                  <button onClick={()=>setFreePlacement(v=>!v)}
                    className={`relative inline-flex w-7 h-4 rounded-full transition-colors ${freePlacement?'bg-orange-500':'bg-gray-600'} cursor-pointer`}>
                    <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${freePlacement?'translate-x-3':'translate-x-0.5'}`}/>
                  </button>
                  フリー
                </label>
              </div>
              {/* SP表示 */}
              {(availableSP.p1>0||availableSP.p2>0) && (
                <div className="flex gap-2 flex-wrap">
                  {availableSP.p1>0 && (
                    <div className="flex items-center gap-0.5">
                      <span className="text-orange-400 text-xs">SP:</span>
                      <div className="flex gap-0.5 flex-wrap">
                        {Array.from({length:Math.min(availableSP.p1,8)}).map((_,i)=>(<div key={i} className="flame-p1" style={{width:6,height:6,borderRadius:1}}/>))}
                        {availableSP.p1>8&&<span className="text-xs text-orange-400">+{availableSP.p1-8}</span>}
                      </div>
                    </div>
                  )}
                  {p2Enabled&&availableSP.p2>0 && (
                    <div className="flex items-center gap-0.5">
                      <span className="text-blue-400 text-xs">P2:</span>
                      <div className="flex gap-0.5 flex-wrap">
                        {Array.from({length:Math.min(availableSP.p2,8)}).map((_,i)=>(<div key={i} className="flame-p2" style={{width:6,height:6,borderRadius:1}}/>))}
                        {availableSP.p2>8&&<span className="text-xs text-blue-400">+{availableSP.p2-8}</span>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 手札エリア（設定が閉じているほど広くなる） */}
          {gameState && !gameOver ? (
            <div className={`flex-1 min-h-0 overflow-hidden p-1 bg-gray-900 grid gap-1 ${p2Enabled?'grid-cols-2':'grid-cols-1'}`}>
              {renderHand('p1')}
              {p2Enabled&&renderHand('p2')}
            </div>
          ) : !gameState ? (
            <div className="flex-1 flex items-center justify-center text-gray-600 text-xs px-2 text-center">
              ▼を押して設定し、開始してください
            </div>
          ) : null}
        </div>
      </div>
      {modalJsx}
      </>
    );
  }

  return (
    <>
    <div className="flex flex-col lg:flex-row" style={{ height: '100%' }}>
      {styleTag}
      {/* Panel toggle */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 bg-gray-900">
        <button
          onClick={() => setShowPanel(v => !v)}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm font-bold"
        >
          {showPanel ? '▲ 設定を閉じる' : '▼ 設定・ステージ選択'}
        </button>
      </div>

      {/* Left panel — controlled by showPanel on all screen sizes */}
      <div className={`${showPanel ? 'flex' : 'hidden'} flex-col w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-gray-700 bg-gray-900 p-3 space-y-3`}>
        <h3 className="font-bold text-white">試し置きモード</h3>

        <div>
          <label className="text-xs text-gray-400 block mb-1">ステージ</label>
          <select
            value={stageId}
            onChange={e => setStageId(e.target.value)}
            disabled={!!gameState}
            className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white"
          >
            {STAGES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">P1デッキ</label>
          {renderDeckSelect('p1', p1GroupFilter, setP1GroupFilter, p1DeckId, setP1DeckId)}
        </div>

        {/* P2 toggle */}
        <div className="flex items-center justify-between py-1">
          <label className="text-xs text-gray-400">P2を操作する</label>
          <button
            onClick={() => !gameState && setP2Enabled(v => !v)}
            disabled={!!gameState}
            className={`relative inline-flex w-10 h-5 rounded-full transition-colors duration-200 ${p2Enabled ? 'bg-blue-500' : 'bg-gray-600'} ${gameState ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${p2Enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {/* フリー配置 toggle */}
        <div className="flex items-center justify-between py-1">
          <div>
            <label className="text-xs text-gray-400 block">フリー配置</label>
            <span className="text-xs text-gray-600">隣接チェックなしで配置</span>
          </div>
          <button
            onClick={() => setFreePlacement(v => !v)}
            className={`relative inline-flex w-10 h-5 rounded-full transition-colors duration-200 ${freePlacement ? 'bg-orange-500' : 'bg-gray-600'} cursor-pointer`}
          >
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${freePlacement ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {p2Enabled && (
          <div>
            <label className="text-xs text-gray-400 block mb-1">P2デッキ</label>
            {renderDeckSelect('p2', p2GroupFilter, setP2GroupFilter, p2DeckId, setP2DeckId)}
          </div>
        )}

        <div className="flex gap-2">
          {!gameState ? (
            <button
              onClick={startGame}
              disabled={false}
              className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded font-bold text-sm"
            >
              ゲーム開始
            </button>
          ) : (
            <>
              <button onClick={resetGame} className="flex-1 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm">リセット</button>
              <button onClick={undo} disabled={!gameState.history.length} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded text-sm">↩</button>
            </>
          )}
        </div>

        {gameState && (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-gray-400">
              <span>ターン</span>
              <span className="text-white font-bold">{Math.min(gameState.turn, 12)}/12</span>
            </div>
            {counts && (
              <div className="mt-2 pt-2 border-t border-gray-700">
                <div className="flex justify-between">
                  <span className="text-orange-400">P1</span>
                  <span className="text-white">{counts.p1}マス</span>
                </div>
                {p2Enabled && (
                  <div className="flex justify-between">
                    <span className="text-blue-400">P2</span>
                    <span className="text-white">{counts.p2}マス</span>
                  </div>
                )}
              </div>
            )}
            {(availableSP.p1 > 0 || availableSP.p2 > 0) && (
              <div className="mt-2 pt-2 border-t border-gray-700 space-y-1.5">
                <div className="text-xs text-gray-400">SP（使用可能）</div>
                {availableSP.p1 > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-orange-400 text-xs w-6">P1</span>
                    <div className="flex gap-0.5 flex-wrap">
                      {Array.from({ length: availableSP.p1 }).map((_, i) => (
                        <div key={i} className="flame-p1" style={{ width: 10, height: 10, borderRadius: 2 }} />
                      ))}
                    </div>
                  </div>
                )}
                {availableSP.p2 > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-blue-400 text-xs w-6">P2</span>
                    <div className="flex gap-0.5 flex-wrap">
                      {Array.from({ length: availableSP.p2 }).map((_, i) => (
                        <div key={i} className="flame-p2" style={{ width: 10, height: 10, borderRadius: 2 }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="text-xs text-gray-600 border-t border-gray-700 pt-2">
          {!IS_TOUCH && <div>X: 右回転 / Y: 左回転</div>}
          {!IS_TOUCH && (
            <>
              <div>ズーム: {cellSize}px/マス</div>
              <input
                type="range" min={12} max={40} value={cellSize}
                onChange={e => setCellSize(Number(e.target.value))}
                className="w-full mt-1"
              />
            </>
          )}
          {IS_TOUCH && <div className="text-gray-700">タッチ操作</div>}
        </div>
      </div>

      {/* Center: Board */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
        {/* Game Over */}
        {gameOver && counts && (
          <div className="p-3 bg-gray-800 border-b border-gray-700 text-center">
            <h3 className="text-lg font-bold text-white mb-1">ゲーム終了！</h3>
            <div className="flex gap-6 justify-center text-sm">
              <div className="text-orange-400 font-bold">P1: {counts.p1}マス</div>
              <div className="text-blue-400 font-bold">P2: {counts.p2}マス</div>
            </div>
            <div className="text-yellow-400 text-sm mt-1">
              {counts.p1 > counts.p2 ? 'P1の勝利！' : counts.p2 > counts.p1 ? 'P2の勝利！' : '引き分け！'}
            </div>
          </div>
        )}

        {/* Compact status bar when game running */}
        {gameState && (
          <div className="flex items-center gap-1.5 px-2 py-1 border-b border-gray-700 bg-gray-900 flex-wrap">
            <span className="text-xs text-gray-400 font-mono">T{Math.min(gameState.turn, 12)}/12</span>
            {counts && (
              <>
                <span className="text-orange-400 text-xs font-bold">P1:{counts.p1}</span>
                {p2Enabled && <span className="text-blue-400 text-xs font-bold">P2:{counts.p2}</span>}
              </>
            )}
            {p2Enabled && !gameOver && (
              <span className="text-gray-500 text-xs">
                {p1Action === null ? 'P1選択中' : 'P2選択中'}
              </span>
            )}
            <div className="ml-auto flex gap-1">
              <button onClick={undo} disabled={!gameState.history.length}
                className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white rounded text-xs">↩</button>
              <button onClick={resetGame}
                className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs">リセット</button>
            </div>
          </div>
        )}

        {/* Mid area: placed LEFT | canvas CENTER | controls RIGHT */}
        <div className="flex flex-shrink-0 overflow-auto" style={{ maxHeight: '52vh' }}>

          {/* LEFT: Placed cards column */}
          {gameState && (
            <div className="w-20 flex-shrink-0 border-r border-gray-700 bg-gray-950 p-1 flex flex-col gap-0.5">
              {placedP1.length > 0 && (
                <div>
                  {/* 1P操作時は直近12枚、2P操作時は直近6枚ずつ */}
                  {(() => {
                    const limit = p2Enabled ? 6 : 12;
                    const shown = placedP1.slice(-limit);
                    return <>
                      <div className="text-xs text-orange-400 font-bold mb-0.5">P1({placedP1.length})</div>
                      {shown.map(({ cardId, turn, isSA }) => {
                        const c = getCard(cardId);
                        return <div key={`${cardId}-${turn}`} className="text-xs text-gray-400 truncate leading-tight">{c?.name ?? cardId}{isSA ? ' (SA)' : ''}</div>;
                      })}
                    </>;
                  })()}
                </div>
              )}
              {p2Enabled && placedP2.length > 0 && (
                <div className="mt-1">
                  {(() => {
                    const shown = placedP2.slice(-6);
                    return <>
                      <div className="text-xs text-blue-400 font-bold mb-0.5">P2({placedP2.length})</div>
                      {shown.map(({ cardId, turn, isSA }) => {
                        const c = getCard(cardId);
                        return <div key={`${cardId}-${turn}`} className="text-xs text-gray-400 truncate leading-tight">{c?.name ?? cardId}{isSA ? ' (SA)' : ''}</div>;
                      })}
                    </>;
                  })()}
                </div>
              )}
              {placedP1.length > 0 && (
                <button
                  onClick={() => {
                    setDeckModalSelected(new Set(placedP1.map(x => x.cardId).slice(0, 15)));
                    setDeckModalName('配置デッキ');
                    setShowDeckModal(true);
                  }}
                  className="mt-auto px-1 py-0.5 bg-orange-700 hover:bg-orange-600 text-white rounded text-xs w-full leading-tight"
                >デッキ作成</button>
              )}
            </div>
          )}

          {/* CENTER: Canvas */}
          {canvasSection}

          {/* RIGHT: Controls column */}
          {renderControlsColumn()}
        </div>

        {/* Hand areas — flex-1 fills remaining space; each renderHand cell stretches to row height */}
        {gameState && !gameOver && (
          <div className={`flex-1 min-h-0 overflow-hidden p-1.5 border-t border-gray-700 bg-gray-900 grid gap-1.5 ${p2Enabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {renderHand('p1')}
            {p2Enabled && renderHand('p2')}
          </div>
        )}
      </div>
    </div>

    {modalJsx}
    </>
  );
}
