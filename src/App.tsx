import { useStore } from './store';
import type { AppMode } from './types';
import { DeckBuilder } from './components/DeckBuilder';
import { BoardSim } from './components/BoardSim';
import { BattleSim } from './components/BattleSim';
import { DrawSim } from './components/DrawSim';

const TABS: { id: AppMode; label: string }[] = [
  { id: 'deckbuilder', label: 'デッキ作成' },
  { id: 'boardsim',   label: '試し置き' },
  { id: 'battle',     label: '対戦' },
  { id: 'drawsim',    label: 'ドロー' },
];

function App() {
  const { mode, setMode } = useStore();

  return (
    <div className="flex flex-col" style={{ height: '100%', backgroundColor: '#0d1f0d' }}>
      {/* Header / Navigation */}
      <header className="flex-shrink-0 border-b border-gray-700 bg-gray-900">
        <div className="flex items-center px-2 sm:px-4 h-10 sm:h-14 gap-1 sm:gap-2">
          <div className="font-bold shrink-0 mr-1 sm:mr-3">
            <span className="text-orange-400 text-sm leading-none">モバナワ</span>
          </div>
          <nav className="flex gap-0.5 sm:gap-1 min-w-0">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={`px-1.5 sm:px-3 py-1 sm:py-2 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  mode === tab.id
                    ? 'bg-orange-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {mode === 'deckbuilder' && <DeckBuilder />}
        {mode === 'boardsim'   && <BoardSim />}
        {mode === 'battle'     && <BattleSim />}
        {mode === 'drawsim'    && <DrawSim />}
      </main>

      {/* Footer — 免責事項 */}
      <footer className="flex-shrink-0 bg-gray-950 border-t border-gray-800 px-3 py-1 flex items-center justify-center">
        <p className="text-gray-600 text-center leading-tight" style={{ fontSize: '10px' }}>
          非公式ファンアプリ — 任天堂株式会社とは無関係です。ナワバトラー・スプラトゥーンは任天堂株式会社の登録商標です。
        </p>
      </footer>
    </div>
  );
}

export default App;
