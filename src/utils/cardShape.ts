import type { PieceShape } from '../types';

export function rotateShape(shape: PieceShape, rotation: 0 | 90 | 180 | 270): PieceShape {
  if (rotation === 0) return shape;
  let result = shape;
  const times = rotation / 90;
  for (let t = 0; t < times; t++) {
    const rows = result.length;
    const cols = result[0]?.length ?? 0;
    const rotated: PieceShape = Array.from({ length: cols }, () => Array(rows).fill(false));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        rotated[c][rows - 1 - r] = result[r][c];
      }
    }
    result = rotated;
  }
  return result;
}

export function getShapeBounds(shape: PieceShape): { minR: number; maxR: number; minC: number; maxC: number } {
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c]) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  return { minR, maxR, minC, maxC };
}

export function defaultShape(size: number): PieceShape {
  const side = Math.ceil(Math.sqrt(size));
  const shape: PieceShape = [];
  let placed = 0;
  for (let r = 0; r < side && placed < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < side && placed < size; c++) {
      row.push(true);
      placed++;
    }
    while (row.length < side) row.push(false);
    shape.push(row);
  }
  return shape;
}
