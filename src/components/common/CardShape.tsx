import type { PieceShape } from '../../types';

interface CardShapeProps {
  shape: PieceShape | null;
  specialPos?: [number, number] | null;
  cellSize?: number;
  p1Color?: string;
  spColor?: string;
  size?: number;
}

export function CardShape({
  shape,
  specialPos,
  cellSize = 8,
  p1Color = '#FF8C00',
  spColor = '#FF4500',
  size,
}: CardShapeProps) {
  if (!shape) {
    return (
      <div
        className="flex items-center justify-center text-gray-500 text-xs border border-gray-700 rounded"
        style={{ width: cellSize * 5, height: cellSize * 5 }}
      >
        {size ? `${size}マス` : '?'}
      </div>
    );
  }

  const rows = shape.length;
  const cols = shape[0]?.length ?? 0;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
        gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
        gap: '1px',
      }}
    >
      {shape.map((row, r) =>
        row.map((cell, c) => {
          const isSP = specialPos && specialPos[0] === r && specialPos[1] === c;
          return (
            <div
              key={`${r}-${c}`}
              style={{
                width: cellSize,
                height: cellSize,
                backgroundColor: cell
                  ? isSP ? spColor : p1Color
                  : 'transparent',
                border: cell ? 'none' : 'none',
              }}
            />
          );
        })
      )}
    </div>
  );
}
