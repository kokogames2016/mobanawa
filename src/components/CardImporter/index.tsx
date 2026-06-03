import { useState, useRef } from 'react';
import { useStore } from '../../store';
import type { Card } from '../../types';

const SYSTEM_PROMPT = `あなたはナワバトラー（スプラトゥーン3のカードゲーム）のカードデータ抽出AIです。
スクリーンショット画像からカードの情報を読み取り、JSON配列として出力してください。

出力形式（JSON配列のみ、他のテキスト不要）：
[
  {
    "id": "連番（画像内のカード順に採番）",
    "name": "カード名",
    "size": マス数（整数）,
    "spp": 必要SP（整数、SPマスなしは0）,
    "hasSpecialSquare": true/false,
    "rarity": "common" or "rare" or "fresh",
    "shape": [
      [false, true, false],
      [true,  true, true ],
      [false, true, false]
    ],
    "specialPos": [x, y]
  }
]

カードのピース形状はできる限り正確に読み取ること。
形状が不明確な場合はshapeをnullにして後で修正できるようにすること。
specialPosはSPマスがない場合はnullにすること。`;

function imageToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function CardImporter() {
  const { cards, addCards } = useStore();
  const [files, setFiles] = useState<File[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [preview, setPreview] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_ANTHROPIC_API_KEY ?? '');

  const maxId = Math.max(0, ...cards.map(c => parseInt(c.id) || 0));

  async function analyze() {
    if (!files.length) return;
    if (!apiKey) { setError('APIキーが未設定です'); return; }
    setAnalyzing(true);
    setError(null);

    try {
      const imageContents = await Promise.all(
        files.map(async (f) => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: f.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: await imageToBase64(f),
          },
        }))
      );

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                ...imageContents,
                { type: 'text', text: `現在のカード最大ID: ${maxId}。次のIDから採番してください。` },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message ?? `HTTP ${response.status}`);
      }

      const data = await response.json();
      const text = data.content?.[0]?.text ?? '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('JSONが見つかりませんでした');
      const parsed: Card[] = JSON.parse(jsonMatch[0]);
      setPreview(parsed);
    } catch (e) {
      setError(String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  function handleAddAll() {
    addCards(preview);
    setPreview([]);
    setFiles([]);
  }

  function handleUpdatePreview(idx: number, updates: Partial<Card>) {
    setPreview(prev => prev.map((c, i) => i === idx ? { ...c, ...updates } : c));
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h2 className="text-xl font-bold text-white mb-4">カードデータ取り込み</h2>

      {/* API Key */}
      <div className="mb-4 p-3 bg-gray-800 rounded border border-gray-700">
        <label className="block text-xs text-gray-400 mb-1">Anthropic APIキー</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="sk-ant-..."
          className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white"
        />
        <p className="text-xs text-gray-500 mt-1">.envのVITE_ANTHROPIC_API_KEYが自動読み込みされます</p>
      </div>

      {/* Upload area */}
      <div
        className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-orange-500 transition-colors mb-4"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); }}
        onDrop={e => {
          e.preventDefault();
          const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
          setFiles(prev => [...prev, ...dropped]);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files ?? [])])}
        />
        <div className="text-gray-400">
          <div className="text-3xl mb-2">📷</div>
          <div>クリックまたはドラッグ＆ドロップで画像を追加</div>
          <div className="text-sm text-gray-500">複数枚対応</div>
        </div>
      </div>

      {files.length > 0 && (
        <div className="mb-4">
          <div className="flex flex-wrap gap-2 mb-3">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-1 bg-gray-800 px-2 py-1 rounded text-xs text-gray-300">
                <span>{f.name}</span>
                <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300">×</button>
              </div>
            ))}
          </div>
          <button
            onClick={analyze}
            disabled={analyzing}
            className="px-6 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded font-bold transition-colors"
          >
            {analyzing ? '解析中...' : '解析開始'}
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-900 border border-red-700 rounded text-red-200 text-sm">
          {error}
        </div>
      )}

      {preview.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-bold">解析結果（{preview.length}枚）</h3>
            <button
              onClick={handleAddAll}
              className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded font-bold text-sm transition-colors"
            >
              全てデータに追加
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-800 text-gray-300">
                  <th className="px-2 py-1 text-left border border-gray-700">ID</th>
                  <th className="px-2 py-1 text-left border border-gray-700">名前</th>
                  <th className="px-2 py-1 text-left border border-gray-700">サイズ</th>
                  <th className="px-2 py-1 text-left border border-gray-700">SPP</th>
                  <th className="px-2 py-1 text-left border border-gray-700">レアリティ</th>
                  <th className="px-2 py-1 text-left border border-gray-700">形状</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((card, i) => (
                  <tr key={i} className="border-b border-gray-700 hover:bg-gray-800">
                    <td className="px-2 py-1 border border-gray-700 text-gray-400">{card.id}</td>
                    <td className="px-2 py-1 border border-gray-700">
                      <input
                        value={card.name}
                        onChange={e => handleUpdatePreview(i, { name: e.target.value })}
                        className="bg-transparent text-white w-full"
                      />
                    </td>
                    <td className="px-2 py-1 border border-gray-700">
                      <input
                        type="number"
                        value={card.size}
                        onChange={e => handleUpdatePreview(i, { size: Number(e.target.value) })}
                        className="bg-transparent text-white w-16"
                      />
                    </td>
                    <td className="px-2 py-1 border border-gray-700">
                      <input
                        type="number"
                        value={card.spp}
                        onChange={e => handleUpdatePreview(i, { spp: Number(e.target.value) })}
                        className="bg-transparent text-white w-12"
                      />
                    </td>
                    <td className="px-2 py-1 border border-gray-700">
                      <select
                        value={card.rarity}
                        onChange={e => handleUpdatePreview(i, { rarity: e.target.value as Card['rarity'] })}
                        className="bg-gray-800 text-white rounded px-1"
                      >
                        <option value="common">Common</option>
                        <option value="rare">Rare</option>
                        <option value="fresh">Fresh</option>
                      </select>
                    </td>
                    <td className="px-2 py-1 border border-gray-700 text-gray-400 text-xs">
                      {card.shape ? `${card.shape.length}×${card.shape[0]?.length}` : 'null'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Current cards count */}
      <div className="mt-6 p-3 bg-gray-800 rounded text-sm text-gray-400">
        現在登録済みカード: <span className="text-white font-bold">{cards.length}枚</span>
      </div>
    </div>
  );
}
