
import { ColorType, Block } from './types';

export const GRID_SIZE = 8;

export const EASY_SHAPES: Block[][] = [
  // 1x1
  [{ x: 0, y: 0 }],
  // 1x2 vertical
  [{ x: 0, y: 0 }, { x: 0, y: 1 }],
  // 1x2 horizontal
  [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  // 2x2 Square
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  // Small L
  [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
];

export const CHALLENGING_SHAPES: Block[][] = [
  // 1x3 vertical
  [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }],
  // 1x4 vertical
  [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }],
  // 1x5 vertical (The most difficult)
  [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }, { x: 0, y: 4 }],
  // Big L-Shapes
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }],
  [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }],
  // T-Shape
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }],
  // J-Shape
  [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }],
  // 3x3 Square (Hardest to fit)
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
];

export const SHAPES = [...EASY_SHAPES, ...CHALLENGING_SHAPES];

export const COLORS: ColorType[] = ['blue', 'purple', 'pink', 'orange', 'green', 'yellow', 'cyan'];

export const COLOR_MAP: Record<ColorType, string> = {
  blue: '#4a8df3',
  purple: '#a855f7',
  pink: '#ec4899',
  orange: '#f97316',
  green: '#10b981',
  yellow: '#fbbf24',
  cyan: '#22d3ee',
};
