
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { GridCell, Piece, ColorType, Block } from './types';
import { GRID_SIZE, EASY_SHAPES, CHALLENGING_SHAPES, SHAPES, COLORS, COLOR_MAP } from './constants';
import { Crown, Star, Play, MapPin, Infinity as InfinityIcon, Home, Calendar as CalendarIcon, ChevronLeft, ChevronRight, X, Cloud, CloudOff, AlertCircle } from 'lucide-react';
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, User } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyA0K4geAuueVfiItB_98-LkqRTnpYNUNvM",
  authDomain: "gameparadise-80490.firebaseapp.com",
  projectId: "gameparadise-80490",
  storageBucket: "gameparadise-80490.firebasestorage.app",
  messagingSenderId: "335620903527",
  appId: "1:335620903527:web:1bc1e01a386bf6e4e7fac2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

interface FloatingScore {
  id: string;
  value: number;
  x: number;
  y: number;
}

const audioCtxRef: { current: AudioContext | null } = { current: null };

const initAudio = () => {
  if (!audioCtxRef.current) {
    audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtxRef.current.state === 'suspended') {
    audioCtxRef.current.resume();
  }
};

const playSound = (type: 'pickup' | 'place' | 'clear' | 'combo' | 'gameover' | 'unbelievable' | 'click', options?: { combo?: number, lines?: number }) => {
  if (!audioCtxRef.current) return;
  const ctx = audioCtxRef.current;
  const now = ctx.currentTime;

  const createOscillator = (freq: number, type: OscillatorType, startTime: number, duration: number, volume: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration);
  };

  switch (type) {
    case 'click':
      createOscillator(500, 'sine', now, 0.05, 0.2);
      break;
    case 'pickup':
      createOscillator(400, 'sine', now, 0.1, 0.2);
      setTimeout(() => createOscillator(600, 'sine', ctx.currentTime, 0.1, 0.15), 30);
      break;
    case 'place':
      createOscillator(150, 'triangle', now, 0.15, 0.4);
      break;
    case 'clear':
      const baseFreq = 800 + (options?.combo || 0) * 100;
      const lines = options?.lines || 1;
      for (let i = 0; i < lines; i++) {
        createOscillator(baseFreq + (i * 200), 'sine', now + (i * 0.05), 0.4, 0.25);
      }
      break;
    case 'combo':
      createOscillator(1200, 'sine', now, 0.1, 0.25);
      createOscillator(1500, 'sine', now + 0.05, 0.1, 0.25);
      break;
    case 'unbelievable':
      [440, 554, 659, 880].forEach((f, i) => {
        createOscillator(f, 'square', now + (i * 0.1), 0.6, 0.08);
      });
      break;
    case 'gameover':
      createOscillator(330, 'sawtooth', now, 0.4, 0.2);
      createOscillator(261, 'sawtooth', now + 0.4, 0.4, 0.2);
      createOscillator(196, 'sawtooth', now + 0.8, 0.8, 0.2);
      break;
  }
};

const BlockComponent: React.FC<{ 
  color: ColorType; 
  size?: number | string; 
  isGhost?: boolean; 
  clearing?: boolean;
  dying?: boolean;
  delay?: number;
}> = ({ color, size = '100%', isGhost, clearing, dying, delay = 0 }) => {
  const baseColor = COLOR_MAP[color];
  if (isGhost) {
    return (
      <div 
        className="rounded-sm opacity-30"
        style={{ width: size, height: size, backgroundColor: baseColor }}
      />
    );
  }

  const animationClass = clearing ? 'animate-clear' : dying ? 'animate-die' : '';

  return (
    <div 
      className={`rounded-sm relative shadow-sm ${animationClass}`}
      style={{ 
        width: size, 
        height: size, 
        backgroundColor: baseColor,
        borderTop: 'max(1px, 0.2rem) solid rgba(255,255,255,0.4)',
        borderLeft: 'max(1px, 0.2rem) solid rgba(255,255,255,0.4)',
        borderBottom: 'max(1px, 0.2rem) solid rgba(0,0,0,0.3)',
        borderRight: 'max(1px, 0.2rem) solid rgba(0,0,0,0.3)',
        animationDelay: (clearing || dying) ? `${delay}ms` : '0ms'
      }}
    >
      <div className="absolute inset-[15%] opacity-30 border-[1px] border-white pointer-events-none" />
    </div>
  );
};

const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<'home' | 'game' | 'streak'>('home');
  const [grid, setGrid] = useState<GridCell[][]>(() =>
    Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill({ filled: false }))
  );
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => Number(localStorage.getItem('block_blast_highscore') || 0));
  const [gameOver, setGameOver] = useState(false);
  const [isDying, setIsDying] = useState(false);
  const [comboCount, setComboCount] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [floatingScores, setFloatingScores] = useState<FloatingScore[]>([]);
  const [unbelievable, setUnbelievable] = useState(false);
  
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [draggingPiece, setDraggingPiece] = useState<Piece | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [ghostPosition, setGhostPosition] = useState<{ row: number; col: number } | null>(null);
  const [calendarDate, setCalendarDate] = useState(new Date());

  // Firebase State
  const [user, setUser] = useState<User | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Reference for the game board to calculate drag positions correctly
  const boardRef = useRef<HTMLDivElement>(null);

  const [playedDates, setPlayedDates] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('block_blast_played_dates');
    if (saved) {
      try { return new Set(JSON.parse(saved)); } catch (e) { return new Set(); }
    }
    return new Set();
  });

  // Authentication logic - Removed anonymous sign-in to fix the restricted operation error.
  // Now syncs only if a user is logged in via a real account.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setSyncing(true);
        try {
          const docRef = doc(db, "users", currentUser.uid, "saveData", "block_blast");
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            const remoteHighScore = Number(data.highScore || 0);
            const remotePlayedDates = new Set<string>(data.playedDates || []);
            const localHighScore = Number(localStorage.getItem('block_blast_highscore') || 0);
            
            if (remoteHighScore > localHighScore) {
              setHighScore(remoteHighScore);
              localStorage.setItem('block_blast_highscore', remoteHighScore.toString());
            }
            
            setPlayedDates(prev => {
              const combined = new Set([...Array.from(prev), ...Array.from(remotePlayedDates)]);
              localStorage.setItem('block_blast_played_dates', JSON.stringify(Array.from(combined)));
              return combined;
            });
          }
        } catch (error) {
          console.error("Firebase Sync Error:", error);
        } finally { 
          setSyncing(false); 
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Cloud Sync logic (Debounced)
  const lastSavedRef = useRef({ highScore: 0, playedDatesCount: 0 });
  useEffect(() => {
    if (!user) return;
    const currentDatesArr = Array.from(playedDates);
    if (highScore === lastSavedRef.current.highScore && currentDatesArr.length === lastSavedRef.current.playedDatesCount) return;
    
    const timer = setTimeout(async () => {
      try {
        const docRef = doc(db, "users", user.uid, "saveData", "block_blast");
        await setDoc(docRef, { 
          highScore, 
          playedDates: currentDatesArr, 
          lastUpdated: new Date() 
        }, { merge: true });
        lastSavedRef.current = { highScore, playedDatesCount: currentDatesArr.length };
      } catch (error) { 
        console.error("Save Error:", error); 
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [highScore, playedDates, user]);

  // Daily Streak tracking logic
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    if (!playedDates.has(today)) {
      setPlayedDates(prev => {
        const next = new Set(prev);
        next.add(today);
        localStorage.setItem('block_blast_played_dates', JSON.stringify(Array.from(next)));
        return next;
      });
    }
  }, []);

  const currentStreak = useMemo(() => {
    let count = 0;
    const checkDate = new Date();
    const todayStr = checkDate.toISOString().split('T')[0];
    if (!playedDates.has(todayStr)) { 
      checkDate.setDate(checkDate.getDate() - 1); 
    }
    while (true) {
      const dateStr = checkDate.toISOString().split('T')[0];
      if (playedDates.has(dateStr)) {
        count++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else { 
        break; 
      }
    }
    return count;
  }, [playedDates]);

  const dimensions = useMemo(() => {
    const boardDim = Math.min(windowSize.width * 0.95, windowSize.height * 0.55, 700);
    const trayCellSize = boardDim / 18;
    const boardCellSize = boardDim / GRID_SIZE;
    return { boardDim, trayCellSize, boardCellSize };
  }, [windowSize]);

  useEffect(() => {
    const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const canFitAt = useCallback((currentGrid: GridCell[][], shape: Block[], row: number, col: number): boolean => {
    const minX = Math.min(...shape.map(b => b.x));
    const minY = Math.min(...shape.map(b => b.y));
    for (const block of shape) {
      const r = row + (block.y - minY);
      const c = col + (block.x - minX);
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE || currentGrid[r][c].filled) return false;
    }
    return true;
  }, []);

  const generateNewPieces = useCallback((currentGrid: GridCell[][], currentScore: number) => {
    const newPieces: Piece[] = [];
    for (let i = 0; i < 3; i++) {
      const pool = Math.random() < 0.3 ? EASY_SHAPES : CHALLENGING_SHAPES;
      const selectedShape = pool[Math.floor(Math.random() * pool.length)];
      newPieces.push({ id: Math.random().toString(36).substr(2, 9), shape: selectedShape, color: COLORS[Math.floor(Math.random() * COLORS.length)], placed: false });
    }
    setPieces(newPieces);
  }, []);

  const triggerGameOver = useCallback(async () => {
    playSound('gameover');
    setIsDying(true);
    await new Promise(r => setTimeout(r, 1500));
    setGameOver(true);
  }, []);

  const resetGame = () => {
    initAudio();
    playSound('place');
    const emptyGrid = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill({ filled: false }));
    setGrid(emptyGrid);
    setScore(0);
    setGameOver(false);
    setIsDying(false);
    setComboCount(0);
    setIsAnimating(false);
    setFloatingScores([]);
    generateNewPieces(emptyGrid, 0);
  };

  const handlePointerDown = (e: React.PointerEvent, piece: Piece) => {
    if (gameOver || isAnimating || isDying) return;
    initAudio();
    playSound('pickup');
    setDraggingPiece(piece);
    setDragPosition({ x: e.clientX, y: e.clientY });
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!draggingPiece || !boardRef.current) return;
    setDragPosition({ x: e.clientX, y: e.clientY });
    const boardRect = boardRef.current.getBoundingClientRect();
    const cellSize = boardRect.width / GRID_SIZE;
    const minX = Math.min(...draggingPiece.shape.map(b => b.x));
    const minY = Math.min(...draggingPiece.shape.map(b => b.y));
    const pieceWidth = (Math.max(...draggingPiece.shape.map(b => b.x)) - minX + 1);
    const pieceHeight = (Math.max(...draggingPiece.shape.map(b => b.y)) - minY + 1);
    const bCol = Math.round(((e.clientX - boardRect.left) - (pieceWidth * cellSize) / 2) / cellSize);
    const bRow = Math.round(((e.clientY - boardRect.top) - 120 - (pieceHeight * cellSize) / 2) / cellSize);
    setGhostPosition(canFitAt(grid, draggingPiece.shape, bRow, bCol) ? { row: bRow, col: bCol } : null);
  };

  const handlePointerUp = async () => {
    if (!draggingPiece) return;
    if (ghostPosition) {
      playSound('place');
      const minX = Math.min(...draggingPiece.shape.map(b => b.x));
      const minY = Math.min(...draggingPiece.shape.map(b => b.y));
      const newGrid = grid.map(row => row.map(cell => ({ ...cell })));
      for (const block of draggingPiece.shape) newGrid[ghostPosition.row + (block.y - minY)][ghostPosition.col + (block.x - minX)] = { filled: true, color: draggingPiece.color };
      const rowsToClear: number[] = [], colsToClear: number[] = [];
      for (let i = 0; i < GRID_SIZE; i++) {
        if (newGrid[i].every(cell => cell.filled)) rowsToClear.push(i);
        if (newGrid.every(row => row[i].filled)) colsToClear.push(i);
      }
      let finalDelta = draggingPiece.shape.length * 10;
      if (rowsToClear.length > 0 || colsToClear.length > 0) {
        setIsAnimating(true);
        rowsToClear.forEach(r => newGrid[r].forEach(c => c.clearing = true));
        colsToClear.forEach(c => newGrid.forEach(r => r[c].clearing = true));
        setGrid(newGrid);
        const lines = rowsToClear.length + colsToClear.length;
        const totalBonus = Math.round(lines * 120 * (comboCount + 1) * (lines >= 2 ? 1.6 : 1));
        finalDelta += totalBonus;
        setComboCount(prev => prev + 1);
        playSound('clear', { combo: comboCount, lines });
        await new Promise(r => setTimeout(r, 600));
        const finalGrid = newGrid.map(row => row.map(cell => cell.clearing ? { filled: false } : cell));
        setGrid(finalGrid);
      } else setComboCount(0);
      setScore(s => s + finalDelta);
      const nextPieces = pieces.map(p => p.id === draggingPiece.id ? { ...p, placed: true } : p);
      setPieces(nextPieces);
      setIsAnimating(false);
      if (nextPieces.every(p => p.placed)) generateNewPieces(newGrid, score + finalDelta);
      else {
        const remaining = nextPieces.filter(p => !p.placed);
        const canFitAny = remaining.some(p => {
          for (let r = 0; r < GRID_SIZE; r++) for (let c = 0; c < GRID_SIZE; c++) if (canFitAt(newGrid, p.shape, r, c)) return true;
          return false;
        });
        if (!canFitAny) triggerGameOver();
      }
    }
    setDraggingPiece(null); setGhostPosition(null);
  };

  useEffect(() => {
    if (currentScreen === 'game') {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    }
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [currentScreen, draggingPiece, ghostPosition, grid, pieces, comboCount, isAnimating, isDying]);

  const goToHome = () => { playSound('click'); setCurrentScreen('home'); };
  const goToGame = () => { initAudio(); playSound('click'); setCurrentScreen('game'); };
  const goToStreak = () => { playSound('click'); setCurrentScreen('streak'); };

  const renderCalendar = () => {
    const year = calendarDate.getFullYear(), month = calendarDate.getMonth();
    const startDay = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < startDay; i++) days.push(<div key={`empty-${i}`} className="h-12 w-12" />);
    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isPlayed = playedDates.has(dStr), isToday = new Date().toISOString().split('T')[0] === dStr;
      days.push(<div key={dStr} className={`h-12 w-12 flex items-center justify-center rounded-2xl text-xl font-black transition-all ${isPlayed ? 'bg-[#4a8df3] text-white shadow-[0_4px_0_#2b5fb3]' : 'bg-white/5 text-white/40'} ${isToday ? 'border-2 border-yellow-400' : ''}`}>{d}</div>);
    }
    return days;
  };

  if (currentScreen === 'streak') {
    return (
      <div className="flex flex-col items-center min-h-screen p-6 bg-gradient-to-b from-[#5d7ebe] to-[#3b5998] animate-in slide-in-from-right duration-300">
        <div className="w-full max-w-sm flex items-center justify-between mt-8 mb-12">
           <button onClick={goToHome} className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-all"><X size={32} /></button>
           <h2 className="text-3xl font-black italic tracking-tighter uppercase drop-shadow-md text-white">Daily Streak</h2>
           <div className="w-10" />
        </div>
        <div className="bg-white/10 backdrop-blur-md rounded-[3rem] p-8 w-full max-w-sm border-2 border-white/10 shadow-2xl">
          <div className="flex items-center justify-between mb-8 text-white">
            <button onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))} className="p-2 hover:bg-white/10 rounded-full"><ChevronLeft size={32} /></button>
            <h3 className="text-2xl font-black italic tracking-tight">{calendarDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
            <button onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))} className="p-2 hover:bg-white/10 rounded-full"><ChevronRight size={32} /></button>
          </div>
          <div className="grid grid-cols-7 gap-2 mb-4 text-[#a5ccff] font-bold text-sm uppercase text-center">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, idx) => <div key={idx}>{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-x-2 gap-y-3 justify-items-center">{renderCalendar()}</div>
        </div>
        <div className="mt-12 text-center text-[#a5ccff] font-bold italic text-lg opacity-80 animate-pulse">Rewards system coming soon!</div>
      </div>
    );
  }

  if (currentScreen === 'home') {
    return (
      <div className="flex flex-col items-center min-h-screen p-6 relative overflow-hidden animate-in fade-in duration-700">
        <div className="fixed top-6 right-6 z-[250] flex items-center gap-2 px-3 py-1.5 bg-white/10 backdrop-blur-md rounded-full border border-white/20">
           {user ? (
             <Cloud size={16} className={syncing ? 'animate-pulse text-yellow-400' : 'text-green-400'} />
           ) : (
             <CloudOff size={16} className="text-red-400" />
           )}
           <span className="text-xs font-bold uppercase tracking-widest text-white/80">
             {user ? (syncing ? 'Syncing...' : 'Cloud Saved') : 'Local Only'}
           </span>
        </div>
        <div className="flex flex-col items-center mt-20 mb-16 select-none scale-110">
          <div className="relative flex items-center">
             <Crown size={48} className="absolute -top-8 left-1/2 -translate-x-1/2 text-yellow-400 fill-yellow-400 drop-shadow-lg rotate-12" />
             <h1 className="flex text-7xl font-black italic tracking-tighter drop-shadow-[0_8px_0_rgba(0,0,0,0.3)]">
                <span className="text-[#f97316]">B</span>
                <span className="text-[#4a8df3]">L</span>
                <span className="text-[#ec4899]">O</span>
                <span className="text-[#f97316]">C</span>
                <span className="text-[#a855f7]">K</span>
             </h1>
          </div>
          <div className="text-6xl font-black text-[#22d3ee] italic tracking-tight drop-shadow-[0_8px_0_rgba(0,0,0,0.3)] -mt-2">BLAST</div>
          <span className="text-[#a5ccff] font-bold text-lg mt-2 uppercase tracking-[0.2em]">Adventure Master</span>
        </div>
        <div className="flex flex-col w-full max-w-sm mb-12 gap-16">
            <button onClick={goToStreak} className="group relative w-full h-20 bg-[#f48fb1] rounded-[2rem] flex items-center justify-center shadow-[0_8px_0_#c2185b] hover:shadow-[0_4px_0_#c2185b] hover:brightness-110 hover:scale-[1.05] active:shadow-none active:translate-y-2 transition-all transform duration-200">
              <CalendarIcon size={36} className="text-white fill-white mr-4 transition-transform group-hover:scale-110" />
              <span className="text-3xl font-black text-white italic tracking-tight uppercase">Daily Streak</span>
              <div className="absolute -top-1 -right-1 flex items-center justify-center w-10 h-10 bg-yellow-400 rounded-full border-4 border-white shadow-md group-hover:rotate-12 transition-transform">
                 <span className="text-[#3b5998] font-black text-lg">{currentStreak}</span>
              </div>
            </button>
            <div className="flex flex-col gap-6">
                <button onClick={goToGame} className="group relative w-full h-20 bg-[#f9a825] rounded-[2rem] flex items-center justify-center shadow-[0_8px_0_#c68400] hover:shadow-[0_4px_0_#c68400] hover:brightness-110 hover:scale-[1.05] active:shadow-none active:translate-y-2 transition-all transform duration-200">
                  <MapPin size={36} className="text-white fill-white mr-4 transition-transform group-hover:scale-110" />
                  <span className="text-3xl font-black text-white italic tracking-tight uppercase">Adventure</span>
                  <div className="absolute -top-1 -right-1 w-6 h-6 bg-red-600 rounded-full border-4 border-white shadow-md animate-pulse" />
                </button>
                <button onClick={goToGame} className="group relative w-full h-20 bg-[#1de9b6] rounded-[2rem] flex items-center justify-center shadow-[0_8px_0_#00b686] hover:shadow-[0_4px_0_#00b686] hover:brightness-110 hover:scale-[1.05] active:shadow-none active:translate-y-2 transition-all transform duration-200">
                  <InfinityIcon size={36} className="text-white mr-4 stroke-[4] transition-transform group-hover:rotate-180" />
                  <span className="text-3xl font-black text-white italic tracking-tight uppercase">Classic</span>
                </button>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center min-h-screen pt-[4vh] p-4 select-none overflow-hidden transition-all duration-300 ${unbelievable ? 'screen-shake' : ''}`}>
      <button onClick={goToHome} className={`fixed top-6 left-6 z-[250] w-14 h-14 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border-2 border-white/20 shadow-lg transition-all active:scale-90 ${isDying ? 'opacity-0' : 'opacity-100'}`}><Home className="text-white" size={28} /></button>
      <div className={`w-full flex flex-col items-center mb-[4vh] gap-1 transition-opacity duration-500 ${isDying ? 'opacity-0' : 'opacity-100'}`} style={{ maxWidth: dimensions.boardDim }}>
        <div className="flex items-center gap-2"><Crown className="text-yellow-400 fill-yellow-400" size={24} /><span className="text-[clamp(1rem,3vw,1.75rem)] font-black text-yellow-400 drop-shadow-md">{highScore.toLocaleString()}</span></div>
        <span className="text-[clamp(3rem,10vw,6rem)] font-black text-white drop-shadow-2xl tracking-tight leading-none">{score.toLocaleString()}</span>
      </div>
      <div ref={boardRef} className={`relative bg-[#2c334d] rounded-xl border-[0.6rem] border-[#22273b] p-[3px] shadow-2xl grid grid-cols-8 gap-[1px] md:gap-[2px] overflow-visible transition-opacity duration-500 ${isDying ? (gameOver ? 'opacity-0' : 'opacity-100') : 'opacity-100'}`} style={{ width: dimensions.boardDim, height: dimensions.boardDim }}>
        {grid.map((row, rIdx) => row.map((cell, cIdx) => {
          const isGhost = ghostPosition && draggingPiece?.shape.some(b => (b.x - Math.min(...draggingPiece.shape.map(x => x.x))) + ghostPosition.col === cIdx && (b.y - Math.min(...draggingPiece.shape.map(x => x.y))) + ghostPosition.row === rIdx);
          return <div key={`${rIdx}-${cIdx}`} className="relative w-full h-full rounded-sm bg-[#3a415a]/30 flex items-center justify-center overflow-visible">{cell.filled ? <BlockComponent color={cell.color!} clearing={cell.clearing} dying={isDying} delay={(rIdx + cIdx) * 30} /> : isGhost ? <BlockComponent color={draggingPiece!.color} isGhost /> : <div className="w-[15%] h-[15%] bg-[#22273b] rounded-full opacity-40" />}</div>;
        }))}
      </div>
      <div className={`mt-[6vh] w-full flex justify-around items-center px-4 h-[15vh] transition-opacity duration-500 ${isDying ? 'opacity-0' : 'opacity-100'}`} style={{ maxWidth: dimensions.boardDim }}>
        {pieces.map(piece => {
          const isVisible = !piece.placed && draggingPiece?.id !== piece.id;
          const traySize = dimensions.trayCellSize * 6;
          return <div key={piece.id} className={`relative flex items-center justify-center transition-all duration-300 ${isVisible && !isAnimating ? 'opacity-100 hover:scale-110' : 'opacity-0 scale-50 pointer-events-none'}`} onPointerDown={e => isVisible && !isAnimating && handlePointerDown(e, piece)} style={{ width: traySize, height: traySize }}>
            <div style={{ position: 'relative', width: (Math.max(...piece.shape.map(b => b.x)) - Math.min(...piece.shape.map(b => b.x)) + 1) * dimensions.trayCellSize, height: (Math.max(...piece.shape.map(b => b.y)) - Math.min(...piece.shape.map(b => b.y)) + 1) * dimensions.trayCellSize }}>
              {piece.shape.map((b, idx) => <div key={idx} className="absolute" style={{ left: (b.x - Math.min(...piece.shape.map(x => x.x))) * dimensions.trayCellSize, top: (b.y - Math.min(...piece.shape.map(x => x.y))) * dimensions.trayCellSize }}><BlockComponent color={piece.color} size={dimensions.trayCellSize - 1} /></div>)}
            </div>
          </div>;
        })}
      </div>
      {draggingPiece && <div className="fixed pointer-events-none z-[70] transform" style={{ left: dragPosition.x, top: dragPosition.y - 120 }}>{draggingPiece.shape.map((b, idx) => <div key={idx} className="absolute" style={{ left: (b.x - Math.min(...draggingPiece.shape.map(x => x.x)) - ((Math.max(...draggingPiece.shape.map(x => x.x)) - Math.min(...draggingPiece.shape.map(x => x.x)) + 1) / 2)) * dimensions.boardCellSize, top: (b.y - Math.min(...draggingPiece.shape.map(x => x.y)) - ((Math.max(...draggingPiece.shape.map(x => x.y)) - Math.min(...draggingPiece.shape.map(x => x.y)) + 1) / 2)) * dimensions.boardCellSize }}><BlockComponent color={draggingPiece.color} size={dimensions.boardCellSize - 2} /></div>)}</div>}
      {gameOver && (
        <div className="fixed inset-0 bg-gradient-to-b from-[#5d7ebe] to-[#3b5998] z-[300] flex flex-col items-center justify-center p-6 animate-in fade-in duration-500 overflow-hidden">
          <h2 className="text-4xl md:text-5xl font-black mb-12 text-[#4da6ff] uppercase animate-bounce">Game Over</h2>
          <p className="text-[#a5ccff] font-bold text-xl uppercase tracking-widest">Score</p>
          <p className="text-7xl font-black text-white mb-8">{score.toLocaleString()}</p>
          <div className="flex flex-col gap-4 w-full max-w-sm">
            <button onClick={resetGame} className="relative w-full h-20 bg-[#34c724] rounded-[2rem] flex items-center justify-center shadow-[0_10px_0_#28a61b] active:translate-y-2 transition-all"><Play size={48} className="text-white fill-white mr-3" /><span className="text-2xl font-black text-white uppercase">Try Again</span></button>
            <button onClick={goToHome} className="w-full h-16 bg-[#4da6ff] rounded-[1.5rem] flex items-center justify-center shadow-[0_6px_0_#3b82f6] active:translate-y-1 transition-all"><span className="text-xl font-black text-white uppercase">Main Menu</span></button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
