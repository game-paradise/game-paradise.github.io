
export type ColorType = 'blue' | 'purple' | 'pink' | 'orange' | 'green' | 'yellow' | 'cyan';

export interface Block {
  x: number;
  y: number;
}

export interface Piece {
  id: string;
  shape: Block[];
  color: ColorType;
  placed: boolean;
}

export interface GridCell {
  filled: boolean;
  color?: ColorType;
  clearing?: boolean;
}

export interface GameState {
  grid: GridCell[][];
  pieces: Piece[];
  score: number;
  highScore: number;
  gameOver: boolean;
  comboCount: number;
}
