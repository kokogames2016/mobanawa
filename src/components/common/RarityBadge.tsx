import type { Rarity } from '../../types';

const rarityConfig: Record<Rarity, { label: string; className: string }> = {
  common: { label: 'C', className: 'bg-gray-600 text-gray-200' },
  rare: { label: 'R', className: 'bg-purple-700 text-purple-100' },
  fresh: { label: 'F', className: 'bg-yellow-500 text-yellow-900' },
};

export function RarityBadge({ rarity }: { rarity: Rarity }) {
  const cfg = rarityConfig[rarity];
  return (
    <span className={`text-xs font-bold px-1 py-0.5 rounded ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}
