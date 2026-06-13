import { useState, useMemo, useEffect } from 'react';
import { useStore, isSampleDeck } from '../../store';
import type { Card, Deck } from '../../types';
import { CardShape } from '../common/CardShape';
import { RarityBadge } from '../common/RarityBadge';
import { shuffleDeck } from '../../utils/boardLogic';
import { useIsLandscape } from '../../hooks/useIsLandscape';

const tap: React.CSSProperties = { touchAction: 'manipulation', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' };

type TurnDir = 'まで' | '以降';
type CondLabel = 'good' | 'bad';

interface ConditionState {
  id: string;
  label: CondLabel;
  name: string;
  trackedIds: string[];
  turns: number;
  turnDir: TurnDir;
  minCount: number;
  enabled: boolean;
  expanded: boolean;
}

type TrialResult = Record<string, boolean>;

interface ChartSeries {
  id: string;
  hex: string;
  label: string;
  pts: number[];
}

// Condition 0=green, 1=red, 2=blue, 3=yellow
const COLORS = [
  { text: 'text-green-400',  hex: '#4ade80', selBg: 'bg-green-900',  selBorder: 'border-green-500',  dot: 'bg-green-400'  },
  { text: 'text-red-400',    hex: '#f87171', selBg: 'bg-red-900',    selBorder: 'border-red-500',    dot: 'bg-red-400'    },
  { text: 'text-blue-400',   hex: '#60a5fa', selBg: 'bg-blue-900',   selBorder: 'border-blue-500',   dot: 'bg-blue-400'   },
  { text: 'text-yellow-400', hex: '#fbbf24', selBg: 'bg-yellow-900', selBorder: 'border-yellow-500', dot: 'bg-yellow-400' },
];

const INITIAL_CONDITIONS: ConditionState[] = [
  { id: 'def-1', label: 'good', name: '初手安定率',    trackedIds: [], turns: 1,  turnDir: 'まで', minCount: 1, enabled: false, expanded: false },
  { id: 'def-2', label: 'bad',  name: '初手事故率',    trackedIds: [], turns: 1,  turnDir: 'まで', minCount: 3, enabled: false, expanded: false },
  { id: 'def-3', label: 'bad',  name: 'デッドドロー率', trackedIds: [], turns: 10, turnDir: '以降', minCount: 2, enabled: false, expanded: false },
];

const DEFAULT_IDS = new Set(['def-1', 'def-2', 'def-3']);

function getCondError(cond: ConditionState): string | null {
  if (!cond.enabled) return null;
  if (cond.trackedIds.length === 0) return 'カードを選択してください';
  if (cond.turns > 12) return 'ターンは12以内で設定してください';
  if (cond.minCount > cond.trackedIds.length) return `必要枚数（${cond.minCount}）が選択カード数（${cond.trackedIds.length}）を超えています`;
  return null;
}

function evalCondition(shuffled: string[], cond: ConditionState): boolean {
  if (cond.trackedIds.length === 0) return false;
  const trackedSet = new Set(cond.trackedIds);
  const start = cond.turnDir === 'まで' ? 0 : Math.min(4 + (cond.turns - 1), shuffled.length);
  const end   = cond.turnDir === 'まで' ? Math.min(4 + (cond.turns - 1), shuffled.length) : shuffled.length;
  return shuffled.slice(start, end).filter(id => trackedSet.has(id)).length >= cond.minCount;
}

// ── Line Chart ────────────────────────────────────────────────────────────────
function LineChart({ series }: { series: ChartSeries[] }) {
  const W = 280, H = 80, PL = 18, PR = 4, PT = 4, PB = 12;
  const maxPts = Math.max(...series.map(s => s.pts.length), 0);
  if (maxPts < 2) {
    return <div className="text-xs text-gray-600 text-center py-1">試行を重ねるとグラフが表示されます</div>;
  }
  const cW = W - PL - PR, cH = H - PT - PB;
  const x = (i: number, n: number) => PL + (i / Math.max(1, n - 1)) * cW;
  const y = (v: number) => PT + (1 - v / 100) * cH;

  function downsample(pts: number[]): number[] {
    if (pts.length <= 150) return pts;
    const step = pts.length / 150;
    return Array.from({ length: 150 }, (_, i) => pts[Math.min(Math.floor(i * step), pts.length - 1)]);
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded" style={{ height: H, background: '#030712' }}>
        {[0, 25, 50, 75, 100].map(pct => (
          <g key={pct}>
            <line x1={PL} x2={W - PR} y1={y(pct)} y2={y(pct)} stroke="#1f2937" strokeWidth="1" />
            <text x={PL - 2} y={y(pct) + 3} textAnchor="end" fill="#4b5563" fontSize="7">{pct}</text>
          </g>
        ))}
        {series.map(s => {
          const pts = downsample(s.pts);
          const n = pts.length;
          const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i, n).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
          return <path key={s.id} d={d} fill="none" stroke={s.hex} strokeWidth="1.5" strokeLinejoin="round" />;
        })}
        <text x={PL + cW / 2} y={H - 1} textAnchor="middle" fill="#4b5563" fontSize="6">試行回数 →</text>
      </svg>
      <div className="flex flex-wrap gap-2 mt-1 justify-center">
        {series.map(s => (
          <span key={s.id} style={{ fontSize: '10px', color: s.hex }}>● {s.label}</span>
        ))}
      </div>
    </div>
  );
}

// ── Condition Item ────────────────────────────────────────────────────────────
function ConditionItem({
  cond, colorIdx, uniqueDeckCards, onChange, onToggleCard, onDelete,
}: {
  cond: ConditionState;
  colorIdx: number;
  uniqueDeckCards: Card[];
  onChange: (updates: Partial<ConditionState>) => void;
  onToggleCard: (cardId: string) => void;
  onDelete?: () => void;
}) {
  const color = COLORS[Math.min(colorIdx, 3)];
  const error = getCondError(cond);

  return (
    <div className={`rounded border ${cond.enabled ? 'border-gray-600' : 'border-gray-800'} bg-gray-900`}>
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <input type="checkbox" checked={cond.enabled}
          onChange={e => onChange({ enabled: e.target.checked })}
          className="shrink-0 accent-orange-500" style={tap} />
        <div className={`w-2 h-2 rounded-full shrink-0 ${color.dot}`} />
        <span className={`text-xs font-bold px-1 rounded shrink-0 ${cond.label === 'good' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}
          style={{ fontSize: '9px' }}>
          {cond.label === 'good' ? 'Good' : 'Bad'}
        </span>
        <span className="text-xs text-gray-300 flex-1 truncate">{cond.name}</span>
        {cond.enabled && error && <span className="text-red-400 shrink-0" style={{ fontSize: '10px' }}>⚠</span>}
        {onDelete && (
          <button type="button" style={tap} onClick={onDelete}
            className="text-gray-600 hover:text-red-400 shrink-0 select-none px-1 text-xs transition-colors">
            ✕
          </button>
        )}
        <button type="button" style={tap} onClick={() => onChange({ expanded: !cond.expanded })}
          className="text-gray-500 shrink-0 select-none px-1 text-xs">
          {cond.expanded ? '▲' : '▼'}
        </button>
      </div>

      {/* Expanded body */}
      {cond.expanded && (
        <div className="px-2 pb-2 space-y-2 border-t border-gray-700 pt-2">
          {/* Good/Bad + Name */}
          <div className="flex gap-1.5 items-center">
            <button type="button" style={tap} onClick={() => onChange({ label: 'good' })}
              className={`px-2 py-0.5 rounded text-xs font-bold select-none ${cond.label === 'good' ? 'bg-green-700 text-white' : 'bg-gray-700 text-gray-400'}`}>
              Good
            </button>
            <button type="button" style={tap} onClick={() => onChange({ label: 'bad' })}
              className={`px-2 py-0.5 rounded text-xs font-bold select-none ${cond.label === 'bad' ? 'bg-red-700 text-white' : 'bg-gray-700 text-gray-400'}`}>
              Bad
            </button>
            <input type="text" value={cond.name} maxLength={20}
              onChange={e => onChange({ name: e.target.value })}
              className="flex-1 px-2 py-0.5 bg-gray-800 border border-gray-600 rounded text-white text-xs"
              placeholder="条件名" />
          </div>

          {/* Turn settings */}
          <div className="flex items-center gap-1.5 flex-wrap" style={{ fontSize: '11px', color: '#9ca3af' }}>
            <select value={cond.turns} onChange={e => onChange({ turns: Number(e.target.value) })}
              className="px-1 py-0.5 bg-gray-800 border border-gray-600 rounded text-white text-xs">
              {Array.from({ length: 12 }, (_, i) => i + 1).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <span>ターン目</span>
            <select value={cond.turnDir} onChange={e => onChange({ turnDir: e.target.value as TurnDir })}
              className="px-1 py-0.5 bg-gray-800 border border-gray-600 rounded text-white text-xs">
              <option value="まで">まで</option>
              <option value="以降">以降</option>
            </select>
            <select value={cond.minCount} onChange={e => onChange({ minCount: Number(e.target.value) })}
              className="px-1 py-0.5 bg-gray-800 border border-gray-600 rounded text-white text-xs">
              {Array.from({ length: Math.max(1, cond.trackedIds.length) }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span>枚以上ドロー</span>
          </div>

          {error && <div className="text-red-400" style={{ fontSize: '11px' }}>{error}</div>}

          {/* Card picker */}
          <div>
            <div className="mb-1" style={{ fontSize: '11px', color: '#6b7280' }}>
              追跡カード
              {cond.trackedIds.length > 0 && (
                <span className={`ml-1 ${color.text}`}>{cond.trackedIds.length}種選択中</span>
              )}
            </div>
            <div className="max-h-28 overflow-y-auto">
              <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(58px, 1fr))' }}>
                {uniqueDeckCards.map(card => {
                  const sel = cond.trackedIds.includes(card.id);
                  return (
                    <button key={card.id} type="button" style={tap} onClick={() => onToggleCard(card.id)}
                      className={`p-0.5 rounded border text-left select-none ${sel ? `${color.selBg} ${color.selBorder}` : 'bg-gray-800 border-gray-600'}`}>
                      <div className="flex items-start gap-0.5">
                        <div className="shrink-0">
                          <CardShape shape={card.shape} specialPos={card.specialPos} cellSize={3} />
                        </div>
                        <div className="min-w-0">
                          <div className={`truncate leading-tight ${sel ? 'text-white' : 'text-gray-300'}`} style={{ fontSize: '8px' }}>{card.name}</div>
                          <div className="text-gray-500" style={{ fontSize: '8px' }}>{card.size}m</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
                {uniqueDeckCards.length === 0 && (
                  <div className="text-gray-600 col-span-full" style={{ fontSize: '10px' }}>デッキを選択してください</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main DrawSim ──────────────────────────────────────────────────────────────
export function DrawSim() {
  const { cards, decks, folders } = useStore();
  const isLandscape = useIsLandscape();

  // Deck selection
  const [groupFilter, setGroupFilter] = useState('');
  const [selectedDeckId, setSelectedDeckId] = useState('');

  // Hand state
  const [drawPile, setDrawPile] = useState<string[]>([]);
  const [hand, setHand] = useState<string[]>([]);
  const [turn, setTurn] = useState(0);
  const [showPile, setShowPile] = useState(false);
  const [passTarget, setPassTarget] = useState<string | null>(null);
  const [reshuffleUsed, setReshuffleUsed] = useState(false);

  // Conditions
  const [conditions, setConditions] = useState<ConditionState[]>(INITIAL_CONDITIONS);

  // Trial results
  const [trialResults, setTrialResults] = useState<TrialResult[]>([]);
  const [currentResult, setCurrentResult] = useState<TrialResult | null>(null);

  const cardMap = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards]);
  function getCard(id: string) { return cardMap.get(id); }

  const userDecks   = useMemo(() => decks.filter(d => d.id !== 'all' && !isSampleDeck(d.id)), [decks]);
  const sampleDecks = useMemo(() => decks.filter(d => isSampleDeck(d.id)), [decks]);
  const inFolderSet = useMemo(() => new Set(folders.flatMap(f => f.deckIds)), [folders]);
  const rootUserDecks = useMemo(() => userDecks.filter(d => !inFolderSet.has(d.id)), [userDecks, inFolderSet]);

  function getDecksForGroup(group: string): Deck[] {
    if (group === 'all')    return decks.filter(d => d.id === 'all');
    if (group === 'root')   return rootUserDecks;
    if (group === 'sample') return sampleDecks;
    const folder = folders.find(f => f.id === group);
    return folder ? folder.deckIds.map(id => userDecks.find(d => d.id === id)).filter((d): d is Deck => !!d) : [];
  }

  function handleGroupChange(g: string) {
    setGroupFilter(g);
    setSelectedDeckId(g === 'all' ? 'all' : '');
  }

  const deckCards = useMemo(() => {
    const deck = decks.find(d => d.id === selectedDeckId);
    return (deck?.cardIds ?? []).map(id => cardMap.get(id)).filter(Boolean) as Card[];
  }, [selectedDeckId, decks, cardMap]);

  const uniqueDeckCards = useMemo(() => {
    const seen = new Set<string>();
    return deckCards.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
  }, [deckCards]);

  // Reset tracked cards when deck changes
  useEffect(() => {
    setConditions(prev => prev.map(c => ({ ...c, trackedIds: [] })));
    setTrialResults([]);
    setCurrentResult(null);
    setTurn(0);
    setHand([]);
    setDrawPile([]);
  }, [selectedDeckId]);

  function updateCondition(id: string, updates: Partial<ConditionState>) {
    setConditions(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  }

  function toggleTrackedCard(condId: string, cardId: string) {
    setConditions(prev => prev.map(c => {
      if (c.id !== condId) return c;
      const trackedIds = c.trackedIds.includes(cardId)
        ? c.trackedIds.filter(id => id !== cardId)
        : [...c.trackedIds, cardId];
      return { ...c, trackedIds, minCount: Math.min(c.minCount, Math.max(1, trackedIds.length)) };
    }));
  }

  function deleteCondition(id: string) {
    setConditions(prev => prev.filter(c => c.id !== id));
  }

  const customCondCount = conditions.filter(c => !DEFAULT_IDS.has(c.id)).length;

  function addCondition() {
    if (customCondCount >= 4) return;
    setConditions(prev => [...prev, {
      id: `custom-${Date.now()}`,
      label: 'good' as CondLabel,
      name: `条件${prev.length + 1}`,
      trackedIds: [],
      turns: 1,
      turnDir: 'まで' as TurnDir,
      minCount: 1,
      enabled: true,
      expanded: true,
    }]);
  }

  // Validation
  const enabledConds = conditions.filter(c => c.enabled);
  const hasErrors = enabledConds.some(c => getCondError(c) !== null);
  const canStart = !!selectedDeckId && enabledConds.length > 0 && !hasErrors;

  function evaluateResult(shuffled: string[]): TrialResult {
    const result: TrialResult = {};
    conditions.forEach(cond => {
      result[cond.id] = cond.enabled ? evalCondition(shuffled, cond) : false;
    });
    return result;
  }

  function startSim() {
    const deck = decks.find(d => d.id === selectedDeckId);
    if (!deck || !canStart) return;
    const shuffled = shuffleDeck(deck.cardIds);
    setHand(shuffled.slice(0, 4));
    setDrawPile(shuffled.slice(4));
    setTurn(1);
    setPassTarget(null);
    setReshuffleUsed(false);
    const result = evaluateResult(shuffled);
    setCurrentResult(result);
    setTrialResults(prev => [...prev, result]);
  }

  function reshuffle() {
    const deck = decks.find(d => d.id === selectedDeckId);
    if (!deck || reshuffleUsed || turn === 0) return;
    const shuffled = shuffleDeck(deck.cardIds);
    setHand(shuffled.slice(0, 4));
    setDrawPile(shuffled.slice(4));
    setTurn(1);
    setPassTarget(null);
    setReshuffleUsed(true);
    const newResult = evaluateResult(shuffled);
    setCurrentResult(newResult);
    setTrialResults(prev => [...prev.slice(0, -1), newResult]);
  }

  function useCard(cardId: string) {
    if (drawPile.length === 0) { setHand(prev => prev.filter(id => id !== cardId)); return; }
    setHand(prev => prev.map(id => id === cardId ? drawPile[0] : id));
    setDrawPile(prev => prev.slice(1));
    setTurn(t => t + 1);
  }

  function doPass() {
    if (!passTarget || drawPile.length === 0) return;
    setHand(prev => prev.map(id => id === passTarget ? drawPile[0] : id));
    setDrawPile([...drawPile.slice(1), passTarget]);
    setPassTarget(null);
    setTurn(t => t + 1);
  }

  function resetStats() { setTrialResults([]); setCurrentResult(null); }

  // Stats (all computed inside memos using `conditions` as dep)
  const totalTrials = trialResults.length;

  const condStats = useMemo(() => {
    const enabled = conditions.filter(c => c.enabled);
    return enabled.map(c => ({
      ...c,
      hits: trialResults.filter(r => r[c.id]).length,
    }));
  }, [conditions, trialResults]);

  const allMatchHits = useMemo(() => {
    const enabled = conditions.filter(c => c.enabled);
    if (enabled.length <= 1) return 0;
    return trialResults.filter(r => enabled.every(c => r[c.id])).length;
  }, [conditions, trialResults]);

  const graphSeries = useMemo((): ChartSeries[] => {
    const enabled = conditions.filter(c => c.enabled);
    if (trialResults.length < 2 || enabled.length === 0) return [];

    const hitCounts: Record<string, number> = {};
    enabled.forEach(c => { hitCounts[c.id] = 0; });
    let allHitCount = 0;

    const seriesData: Record<string, number[]> = {};
    enabled.forEach(c => { seriesData[c.id] = []; });
    const allData: number[] = [];

    trialResults.forEach((r, i) => {
      const n = i + 1;
      enabled.forEach(c => {
        if (r[c.id]) hitCounts[c.id]++;
        seriesData[c.id].push(hitCounts[c.id] / n * 100);
      });
      if (enabled.length > 1) {
        if (enabled.every(c => r[c.id])) allHitCount++;
        allData.push(allHitCount / n * 100);
      }
    });

    const result: ChartSeries[] = enabled.map(c => {
      const idx = conditions.findIndex(cc => cc.id === c.id);
      return { id: c.id, hex: COLORS[Math.min(idx, 3)].hex, label: c.name, pts: seriesData[c.id] };
    });

    if (enabled.length > 1) {
      result.push({ id: '__all__', hex: '#6b7280', label: '全条件一致', pts: allData });
    }
    return result;
  }, [conditions, trialResults]);

  const pct = (hits: number) => totalTrials > 0 ? `${(hits / totalTrials * 100).toFixed(1)}%` : '—';

  // ── UI blocks ─────────────────────────────────────────────────────────────────

  const deckSelectRow = (
    <div className="flex flex-col gap-1.5 mb-3">
      <select value={groupFilter} onChange={e => handleGroupChange(e.target.value)}
        className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-white text-sm">
        <option value="">グループを選択...</option>
        <option value="all">全カード（{cards.length}枚）</option>
        {rootUserDecks.length > 0 && <option value="root">マイデッキ直下</option>}
        {folders.map(f => <option key={f.id} value={f.id}>📁 {f.name}</option>)}
        {sampleDecks.length > 0 && <option value="sample">サンプルデッキ</option>}
      </select>
      {groupFilter !== '' && groupFilter !== 'all' && (
        <select value={selectedDeckId} onChange={e => setSelectedDeckId(e.target.value)}
          className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-white text-sm">
          <option value="">デッキを選択...</option>
          {getDecksForGroup(groupFilter).map(d => {
            const rCount = d.reserveCardIds?.length ?? 0;
            const label = rCount > 0
              ? `${d.name} (メイン${d.cardIds.length}枚 +予備${rCount})`
              : `${d.name} (${d.cardIds.length}枚)`;
            return <option key={d.id} value={d.id}>{label}</option>;
          })}
        </select>
      )}
      {selectedDeckId && (
        <div className="flex gap-2">
          <button type="button" style={tap} onClick={startSim} disabled={!canStart}
            className="flex-1 py-1.5 bg-orange-600 active:bg-orange-500 disabled:opacity-40 text-white rounded font-bold select-none text-sm">
            開始
          </button>
          {turn > 0 && (
            <button type="button" style={tap} onClick={reshuffle} disabled={reshuffleUsed}
              className="px-3 py-1.5 bg-gray-700 active:bg-gray-600 disabled:opacity-30 text-white rounded shrink-0 select-none text-sm">
              リシャッフル
            </button>
          )}
        </div>
      )}
    </div>
  );

  // ── Conditions panel ──────────────────────────────────────────────────────────
  const conditionsPanel = selectedDeckId ? (
    <div className="mb-3 space-y-1.5">
      {conditions.map((cond, idx) => (
        <ConditionItem
          key={cond.id}
          cond={cond}
          colorIdx={idx}
          uniqueDeckCards={uniqueDeckCards}
          onChange={updates => updateCondition(cond.id, updates)}
          onToggleCard={cardId => toggleTrackedCard(cond.id, cardId)}
          onDelete={!DEFAULT_IDS.has(cond.id) ? () => deleteCondition(cond.id) : undefined}
        />
      ))}
      {customCondCount < 4 && (
        <button type="button" style={tap} onClick={addCondition}
          className="w-full py-1.5 border border-dashed border-gray-600 rounded select-none text-xs text-gray-500 hover:text-gray-300 hover:border-gray-400 transition-colors">
          ＋ 条件を追加
        </button>
      )}
    </div>
  ) : null;

  // ── Results panel ─────────────────────────────────────────────────────────────
  const resultsPanel = totalTrials > 0 ? (
    <div className="mb-3 p-2.5 bg-gray-900 border border-gray-700 rounded space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-white">確率計算結果</span>
        <button type="button" style={tap} onClick={resetStats}
          className="px-2 py-0.5 text-xs bg-gray-700 active:bg-gray-600 text-gray-300 rounded select-none">
          リセット
        </button>
      </div>

      {condStats.map(c => {
        const idx = conditions.findIndex(cc => cc.id === c.id);
        const color = COLORS[Math.min(Math.max(idx, 0), 3)];
        return (
          <div key={c.id} className="leading-relaxed" style={{ fontSize: '11px' }}>
            <span className={`font-bold ${color.text}`}>{c.name}　</span>
            <span className="text-gray-400">試行{totalTrials}回・成功{c.hits}回・</span>
            <span className={`font-bold tabular-nums ${color.text}`}>{pct(c.hits)}</span>
          </div>
        );
      })}

      {enabledConds.length > 1 && (
        <div className="leading-relaxed border-t border-gray-700 pt-1" style={{ fontSize: '11px' }}>
          <span className="font-bold text-gray-400">【全条件一致】</span>
          <span className="text-gray-400">試行{totalTrials}回・全条件同時成立{allMatchHits}回・</span>
          <span className="font-bold tabular-nums text-gray-400">{pct(allMatchHits)}</span>
        </div>
      )}

      <LineChart series={graphSeries} />

      {currentResult && (
        <div className="border-t border-gray-700 pt-1 flex flex-wrap gap-1" style={{ fontSize: '10px' }}>
          <span className="text-gray-500">直前：</span>
          {enabledConds.map(c => {
            const hit = currentResult[c.id];
            const idx = conditions.findIndex(cc => cc.id === c.id);
            const color = COLORS[Math.min(Math.max(idx, 0), 3)];
            return (
              <span key={c.id} className={hit ? color.text : 'text-gray-600'}>
                {hit ? '✓' : '✗'}{c.name}
              </span>
            );
          })}
          {reshuffleUsed && <span className="text-yellow-600">（リシャッフル済）</span>}
        </div>
      )}
    </div>
  ) : null;

  // ── Hand section ──────────────────────────────────────────────────────────────
  const handSection = turn > 0 ? (
    <>
      <div className="flex gap-4 mb-3 text-sm text-gray-400">
        <span>ターン: <span className="text-white font-bold">{turn}</span></span>
        <span>山札: <span className="text-white font-bold">{drawPile.length}枚</span></span>
      </div>
      <div className="mb-3">
        <h3 className="text-white font-bold mb-2 text-sm">手札（4枚）</h3>
        <div className="grid grid-cols-4 gap-2">
          {hand.map(id => {
            const card = getCard(id);
            const isPassTarget = passTarget === id;
            const matchingIdxs = conditions
              .map((c, idx) => ({ idx, c }))
              .filter(({ c }) => c.enabled && c.trackedIds.includes(id));
            if (!card) return null;
            return (
              <div key={id} className={`p-2 rounded border transition-all ${
                isPassTarget ? 'border-yellow-400 bg-yellow-900' :
                matchingIdxs.length > 0 ? `${COLORS[Math.min(matchingIdxs[0].idx, 3)].selBorder} bg-gray-800` :
                'border-gray-600 bg-gray-800'
              }`}>
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs text-white font-medium leading-tight truncate">{card.name}</span>
                  <RarityBadge rarity={card.rarity} />
                </div>
                {matchingIdxs.length > 0 && (
                  <div className="flex gap-0.5 justify-center mb-1">
                    {matchingIdxs.map(({ idx, c }) => (
                      <span key={idx} className={`font-bold ${COLORS[Math.min(idx, 3)].text}`} style={{ fontSize: '9px' }}>
                        {c.label === 'good' ? '🟢' : '🔴'}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex justify-center mb-1">
                  <CardShape shape={card.shape} specialPos={card.specialPos} cellSize={5} />
                </div>
                <div className="text-xs text-gray-400 text-center mb-2">
                  {card.size}マス {card.hasSpecialSquare ? `/ SP${card.spp}` : ''}
                </div>
                <div className="flex gap-1">
                  <button type="button" style={tap} onClick={() => useCard(id)}
                    className="flex-1 py-1 bg-orange-700 active:bg-orange-600 text-white rounded text-xs select-none">使う</button>
                  <button type="button" style={tap} onClick={() => setPassTarget(isPassTarget ? null : id)}
                    className={`flex-1 py-1 rounded text-xs select-none ${isPassTarget ? 'bg-yellow-600 text-white' : 'bg-gray-700 active:bg-gray-600 text-white'}`}>パス</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {passTarget && (
        <div className="mb-3 p-2.5 bg-yellow-900 border border-yellow-600 rounded flex items-center justify-between">
          <span className="text-yellow-200 text-sm">「{getCard(passTarget)?.name}」を山札末尾に戻す</span>
          <div className="flex gap-2">
            <button type="button" style={tap} onClick={doPass} disabled={drawPile.length === 0}
              className="px-3 py-1 bg-yellow-600 active:bg-yellow-500 disabled:opacity-50 text-white rounded text-sm select-none">確定</button>
            <button type="button" style={tap} onClick={() => setPassTarget(null)}
              className="px-3 py-1 bg-gray-700 active:bg-gray-600 text-white rounded text-sm select-none">取消</button>
          </div>
        </div>
      )}
      <div>
        <button type="button" style={tap} onClick={() => setShowPile(p => !p)}
          className="mb-2 px-3 py-1.5 bg-gray-700 active:bg-gray-600 text-white rounded text-sm select-none">
          {showPile ? '山札を隠す' : '引き順を見る'} ({drawPile.length}枚)
        </button>
        {showPile && (
          <div className="grid grid-cols-6 gap-1">
            {drawPile.map((id, i) => {
              const card = getCard(id);
              return (
                <div key={i} className="p-1 bg-gray-800 rounded border border-gray-700 text-xs">
                  <div className="text-gray-500 text-center">{i + 1}</div>
                  <div className="flex justify-center">
                    <CardShape shape={card?.shape ?? null} cellSize={5} size={card?.size} />
                  </div>
                  <div className="text-gray-400 text-center truncate">{card?.name}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  ) : null;

  const emptyState = !selectedDeckId ? (
    <div className="text-center text-gray-600 py-12">
      <div className="text-4xl mb-4">🃏</div>
      <div>デッキを選択してシミュレーションを開始してください</div>
    </div>
  ) : null;

  // ─── Landscape ───────────────────────────────────────────────────────────────
  if (isLandscape) {
    return (
      <div className="flex flex-row overflow-hidden" style={{ height: '100%' }}>
        <div className="overflow-y-auto p-2 border-r border-gray-700 bg-gray-950 flex-shrink-0" style={{ width: '40%' }}>
          <h2 className="text-sm font-bold text-white mb-2">ドローシム</h2>
          {deckSelectRow}
          {conditionsPanel}
          {resultsPanel}
          {emptyState}
        </div>
        <div className="flex-1 overflow-y-auto p-2 bg-gray-950">
          {handSection}
        </div>
      </div>
    );
  }

  // ─── Portrait ────────────────────────────────────────────────────────────────
  return (
    <div className="overflow-y-auto p-4 max-w-3xl mx-auto" style={{ height: '100%' }}>
      <h2 className="text-xl font-bold text-white mb-4">ドローシミュレーション</h2>
      {deckSelectRow}
      {conditionsPanel}
      {resultsPanel}
      {handSection}
      {emptyState}
    </div>
  );
}
