import { useState, useMemo } from 'react';
import { useStore, isSampleDeck } from '../../store';
import type { Card, Deck } from '../../types';
import { CardShape } from '../common/CardShape';
import { RarityBadge } from '../common/RarityBadge';
import { shuffleDeck } from '../../utils/boardLogic';
import { useIsLandscape } from '../../hooks/useIsLandscape';

const tap: React.CSSProperties = { touchAction: 'manipulation', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' };

export function DrawSim() {
  const { cards, decks, folders } = useStore();
  const isLandscape = useIsLandscape();
  const [groupFilter, setGroupFilter] = useState<string>('');   // '' | 'all' | 'root' | folderId | 'sample'
  const [selectedDeckId, setSelectedDeckId] = useState<string>('');
  const [drawPile, setDrawPile] = useState<string[]>([]);
  const [hand, setHand] = useState<string[]>([]);
  const [turn, setTurn] = useState(0);
  const [showPile, setShowPile] = useState(false);
  const [passTarget, setPassTarget] = useState<string | null>(null);

  // Reshuffle lock
  const [reshuffleUsed, setReshuffleUsed] = useState(false);

  // Probability tracking
  const [trackedCardIds, setTrackedCardIds] = useState<Set<string>>(new Set());
  const [trials, setTrials] = useState(0);
  const [hits, setHits] = useState(0);
  const [currentHit, setCurrentHit] = useState(false);

  const cardMap = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards]);
  function getCard(id: string): Card | undefined { return cardMap.get(id); }

  // ── フォルダ階層デック一覧 ────────────────────────────────────────────────────
  const userDecks   = useMemo(() => decks.filter(d => d.id !== 'all' && !isSampleDeck(d.id)), [decks]);
  const sampleDecks = useMemo(() => decks.filter(d => isSampleDeck(d.id)), [decks]);
  const inFolderSet = useMemo(() => new Set(folders.flatMap(f => f.deckIds)), [folders]);
  const rootUserDecks = useMemo(() => userDecks.filter(d => !inFolderSet.has(d.id)), [userDecks, inFolderSet]);

  function getDecksForGroup(group: string): Deck[] {
    if (group === 'all')    return decks.filter(d => d.id === 'all');
    if (group === 'root')   return rootUserDecks;
    if (group === 'sample') return sampleDecks;
    const folder = folders.find(f => f.id === group);
    if (!folder) return [];
    return folder.deckIds.map(id => userDecks.find(d => d.id === id)).filter((d): d is Deck => !!d);
  }

  function handleGroupChange(newGroup: string) {
    setGroupFilter(newGroup);
    // 全カードは1択なので直接セット
    setSelectedDeckId(newGroup === 'all' ? 'all' : '');
  }

  const deckCards = useMemo(() => {
    const deck = decks.find(d => d.id === selectedDeckId);
    return (deck?.cardIds ?? []).map(id => cardMap.get(id)).filter(Boolean) as Card[];
  }, [selectedDeckId, decks, cardMap]);

  function checkHit(handIds: string[], tracked: Set<string>): boolean {
    if (tracked.size === 0) return false;
    return handIds.some(id => tracked.has(id));
  }

  function startSim() {
    const deck = decks.find(d => d.id === selectedDeckId);
    if (!deck) return;
    const shuffled = shuffleDeck(deck.cardIds);
    const newHand = shuffled.slice(0, 4);
    setHand(newHand);
    setDrawPile(shuffled.slice(4));
    setTurn(1);
    setPassTarget(null);
    setReshuffleUsed(false);

    if (trackedCardIds.size > 0) {
      const hit = checkHit(newHand, trackedCardIds);
      setCurrentHit(hit);
      setTrials(t => t + 1);
      if (hit) setHits(h => h + 1);
    }
  }

  function reshuffle() {
    const deck = decks.find(d => d.id === selectedDeckId);
    if (!deck || reshuffleUsed) return;
    const shuffled = shuffleDeck(deck.cardIds);
    const newHand = shuffled.slice(0, 4);
    setHand(newHand);
    setDrawPile(shuffled.slice(4));
    setTurn(1);
    setPassTarget(null);
    setReshuffleUsed(true);

    if (trackedCardIds.size > 0) {
      const newHit = checkHit(newHand, trackedCardIds);
      setHits(h => h + (newHit ? 1 : 0) - (currentHit ? 1 : 0));
      setCurrentHit(newHit);
    }
  }

  function useCard(cardId: string) {
    if (drawPile.length === 0) {
      setHand(prev => prev.filter(id => id !== cardId));
      return;
    }
    const newCard = drawPile[0];
    setHand(prev => prev.map(id => id === cardId ? newCard : id));
    setDrawPile(prev => prev.slice(1));
    setTurn(t => t + 1);
  }

  function doPass() {
    if (!passTarget || drawPile.length === 0) return;
    const newCard = drawPile[0];
    const newPile = [...drawPile.slice(1), passTarget];
    setHand(prev => prev.map(id => id === passTarget ? newCard : id));
    setDrawPile(newPile);
    setPassTarget(null);
    setTurn(t => t + 1);
  }

  function toggleTrackedCard(id: string) {
    setTrackedCardIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function resetStats() {
    setTrials(0);
    setHits(0);
    setCurrentHit(false);
  }

  const probability = trials > 0 ? (hits / trials * 100).toFixed(1) : '—';

  // ─── Shared JSX blocks ───────────────────────────────────────────────────────

  const deckSelectRow = (
    <div className="flex flex-col gap-1.5 mb-3">
      {/* Step 1: グループ（フォルダ）選択 */}
      <select value={groupFilter} onChange={e => handleGroupChange(e.target.value)}
        className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-white text-sm">
        <option value="">グループを選択...</option>
        <option value="all">全カード（{cards.length}枚）</option>
        {rootUserDecks.length > 0 && <option value="root">マイデッキ直下</option>}
        {folders.map(f => <option key={f.id} value={f.id}>📁 {f.name}</option>)}
        {sampleDecks.length > 0 && <option value="sample">サンプルデッキ</option>}
      </select>

      {/* Step 2: デッキ選択（全カード以外のとき表示） */}
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

      {/* 開始・リシャッフルボタン行 */}
      {selectedDeckId && (
        <div className="flex gap-2">
          <button type="button" style={tap} onClick={startSim}
            className="flex-1 py-1.5 bg-orange-600 active:bg-orange-500 text-white rounded font-bold select-none text-sm">
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

  const probabilityPanel = selectedDeckId ? (
    <div className="mb-3 p-2.5 bg-gray-900 border border-gray-700 rounded">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-white">確率計算</span>
        <button type="button" style={tap} onClick={resetStats}
          className="px-2 py-0.5 text-xs bg-gray-700 active:bg-gray-600 text-gray-300 rounded select-none">
          リセット
        </button>
      </div>
      <div className="flex gap-3 text-sm mb-2">
        <span className="text-gray-400">試行: <span className="text-white font-bold tabular-nums">{trials}</span></span>
        <span className="text-gray-400">成功: <span className="text-green-400 font-bold tabular-nums">{hits}</span></span>
        <span className="text-gray-400">確率: <span className="text-orange-400 font-bold tabular-nums">{probability}{trials > 0 ? '%' : ''}</span></span>
      </div>
      <div className="text-xs text-gray-500 mb-1">
        追跡カード
        {trackedCardIds.size > 0 && <span className="text-orange-400 ml-1">{trackedCardIds.size}枚選択中</span>}
      </div>
      <div className="max-h-40 overflow-y-auto">
        <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))' }}>
          {deckCards.map(card => {
            const selected = trackedCardIds.has(card.id);
            return (
              <button key={card.id} type="button" style={tap} onClick={() => toggleTrackedCard(card.id)}
                className={`p-0.5 rounded border text-left select-none transition-colors ${
                  selected ? 'bg-orange-800 border-orange-500' : 'bg-gray-800 border-gray-600 active:border-orange-400'
                }`}>
                <div className="flex items-start gap-0.5">
                  <div className="shrink-0"><CardShape shape={card.shape} specialPos={card.specialPos} cellSize={3} /></div>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className={`truncate leading-tight ${selected ? 'text-white' : 'text-gray-300'}`} style={{ fontSize: '8px' }}>{card.name}</div>
                    <div className="text-gray-500 leading-tight" style={{ fontSize: '8px' }}>{card.size}m{card.spp > 0 ? ` S${card.spp}` : ''}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {trackedCardIds.size === 0 && <div className="text-xs text-gray-600 mt-1">カードを選択すると確率を計算します</div>}
    </div>
  ) : null;

  const handSection = turn > 0 ? (
    <>
      {/* ステータス */}
      <div className="flex gap-4 mb-3 text-sm text-gray-400">
        <span>ターン: <span className="text-white font-bold">{turn}</span></span>
        <span>山札: <span className="text-white font-bold">{drawPile.length}枚</span></span>
      </div>

      {/* 手札 */}
      <div className="mb-3">
        <h3 className="text-white font-bold mb-2 text-sm">手札（4枚）</h3>
        <div className="grid grid-cols-4 gap-2">
          {hand.map(id => {
            const card = getCard(id);
            const isPassTarget = passTarget === id;
            const isTracked = trackedCardIds.has(id);
            if (!card) return null;
            return (
              <div key={id} className={`p-2 rounded border transition-all ${
                isPassTarget ? 'border-yellow-400 bg-yellow-900' :
                isTracked ? 'border-orange-500 bg-gray-800' : 'border-gray-600 bg-gray-800'
              }`}>
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs text-white font-medium leading-tight truncate">{card.name}</span>
                  <RarityBadge rarity={card.rarity} />
                </div>
                {isTracked && <div className="text-xs text-orange-400 text-center mb-1">★追跡</div>}
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

      {/* 山札 */}
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

  // ─── Landscape layout ─────────────────────────────────────────────────────────
  if (isLandscape) {
    return (
      <div className="flex flex-row overflow-hidden" style={{ height: '100%' }}>
        {/* LEFT 40%: デッキ選択 + 確率計算 */}
        <div className="overflow-y-auto p-2 border-r border-gray-700 bg-gray-950 flex-shrink-0" style={{ width: '40%' }}>
          <h2 className="text-sm font-bold text-white mb-2">ドローシム</h2>
          {deckSelectRow}
          {probabilityPanel}
          {emptyState}
        </div>
        {/* RIGHT 60%: 手札 + 山札 */}
        <div className="flex-1 overflow-y-auto p-2 bg-gray-950">
          {handSection}
        </div>
      </div>
    );
  }

  // ─── Portrait layout ──────────────────────────────────────────────────────────
  return (
    <div className="overflow-y-auto p-4 max-w-3xl mx-auto" style={{ height: '100%' }}>
      <h2 className="text-xl font-bold text-white mb-4">ドローシミュレーション</h2>
      {deckSelectRow}
      {probabilityPanel}
      {handSection}
      {emptyState}
    </div>
  );
}
