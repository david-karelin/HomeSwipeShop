
import React, { useState } from 'react';
import { Product } from '../types';
import { Heart, X, ShoppingCart, Bookmark } from 'lucide-react';

interface SwipeCardProps {
  product: Product;
  onSwipe: (direction: 'left' | 'right') => void;
  onSelectAction: (action: 'wishlist' | 'cart') => void;
  onTap: () => void;
}

const SwipeCard: React.FC<SwipeCardProps> = ({ product, onSwipe, onSelectAction, onTap }) => {
  const [isSwiping, setIsSwiping] = useState<'left' | 'right' | null>(null);
  const [showActionPrompt, setShowActionPrompt] = useState(false);
  
  // Drag State
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [hasMoved, setHasMoved] = useState(false);
  
  const SWIPE_THRESHOLD = 120;
  const TAP_THRESHOLD = 10;
  const ROTATION_FACTOR = 0.1; // Degrees per pixel

  const handlePointerDown = (e: React.PointerEvent) => {
    if (showActionPrompt) return;
    setIsDragging(true);
    setHasMoved(false);
    setDragStart({ x: e.clientX, y: e.clientY });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    
    if (Math.abs(dx) > TAP_THRESHOLD || Math.abs(dy) > TAP_THRESHOLD) {
      setHasMoved(true);
    }
    
    setOffset({ x: dx, y: dy });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    if (!hasMoved) {
      onTap();
      setOffset({ x: 0, y: 0 });
      return;
    }

    if (offset.x > SWIPE_THRESHOLD) {
      completeSwipe('right');
    } else if (offset.x < -SWIPE_THRESHOLD) {
      completeSwipe('left');
    } else {
      setOffset({ x: 0, y: 0 });
    }
  };

  const completeSwipe = (dir: 'left' | 'right') => {
    setIsSwiping(dir);
    setOffset({ x: dir === 'right' ? 500 : -500, y: offset.y });
    
    setTimeout(() => {
      if (dir === 'right') {
        setShowActionPrompt(true);
      } else {
        onSwipe('left');
      }
    }, 200);
  };

  const triggerSwipe = (dir: 'left' | 'right') => {
    completeSwipe(dir);
  };

  const rotation = offset.x * ROTATION_FACTOR;
  const opacityNope = Math.min(Math.max(-offset.x / SWIPE_THRESHOLD, 0), 1);
  const opacityLike = Math.min(Math.max(offset.x / SWIPE_THRESHOLD, 0), 1);

  if (showActionPrompt) {
    return (
      <div className="relative w-full max-w-sm aspect-[3/4] bg-white rounded-[2.5rem] shadow-2xl p-8 flex flex-col items-center justify-center text-center space-y-6 animate-in zoom-in duration-300">
        <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center animate-bounce">
          <Heart className="w-12 h-12 text-[var(--seligo-accent)] fill-current" />
        </div>
        <div>
          <h3 className="text-3xl font-black text-slate-900 tracking-tight">Style Match!</h3>
          <p className="text-slate-500 mt-2 font-medium">Keep "{product.name}" in your collection?</p>
        </div>
        <div className="grid grid-cols-2 gap-4 w-full pt-4">
          <button
            onClick={() => onSelectAction('wishlist')}
            className="flex flex-col items-center justify-center p-6 bg-slate-50 hover:bg-[var(--seligo-primary)]/10 border border-slate-100 rounded-3xl transition-all group"
          >
            <Bookmark className="w-8 h-8 text-slate-400 group-hover:text-[var(--seligo-primary)] mb-2 transition-transform group-hover:scale-110" />
            <span className="text-xs font-black uppercase tracking-widest text-slate-500 group-hover:text-[var(--seligo-primary)]">Wishlist</span>
          </button>
          <button
            onClick={() => onSelectAction('cart')}
            className="flex flex-col items-center justify-center p-6 bg-slate-50 hover:bg-orange-50 border border-slate-100 rounded-3xl transition-all group"
          >
            <ShoppingCart className="w-8 h-8 text-slate-400 group-hover:text-[var(--seligo-cta)] mb-2 transition-transform group-hover:scale-110" />
            <span className="text-xs font-black uppercase tracking-widest text-slate-500 group-hover:text-[var(--seligo-cta)]">Add to Bag</span>
          </button>
        </div>
      </div>
    );
  }


  return (
    <div 
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        transform: `translate3d(${offset.x}px, ${offset.y}px, 0) rotate(${rotation}deg) scale(${isDragging ? 1.02 : 1})`,
        transition: isDragging
          ? "none"
          : "transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.25s ease",
        touchAction: 'none',
        cursor: isDragging ? 'grabbing' : 'grab',
        willChange: "transform",
      }}
      className={[
        "relative w-full",
        "max-w-[360px] sm:max-w-sm",
        "aspect-[10/13]",
        "bg-white rounded-[2.25rem]",
        "shadow-[0_18px_45px_rgba(0,0,0,0.18)]",
        "overflow-hidden select-none touch-none",
        isSwiping ? "opacity-0 scale-95" : "opacity-100",
      ].join(" ")}
    >
      <img
        src={product.imageUrl}
        alt={product.name}
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
      />

      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent pointer-events-none" />

      <div
        style={{ opacity: opacityLike }}
        className="absolute top-6 left-6 border-2 border-[var(--seligo-accent)] rounded-xl px-4 py-2 rotate-[-12deg] pointer-events-none z-20 bg-emerald-500/10 backdrop-blur-sm"
      >
        <span className="text-[var(--seligo-accent)] text-3xl font-black uppercase tracking-tight">
          LIKE
        </span>
      </div>

      <div
        style={{ opacity: opacityNope }}
        className="absolute top-6 right-6 border-2 border-rose-500 rounded-xl px-4 py-2 rotate-[12deg] pointer-events-none z-20 bg-rose-500/10 backdrop-blur-sm"
      >
        <span className="text-rose-500 text-3xl font-black uppercase tracking-tight">
          PASS
        </span>
      </div>

      <div className="absolute bottom-0 left-0 right-0 px-6 pb-6 pt-4 text-white">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-[var(--seligo-primary)] mb-2">
          Seligo.AI
        </div>

        <div className="flex items-end justify-between gap-3">
          <h2 className="text-[28px] leading-[1.05] font-extrabold line-clamp-2 drop-shadow-md">
            {product.name}
          </h2>

          <div className="shrink-0 text-[18px] font-black text-white/95 drop-shadow-md">
            ${Number(product.price || 0).toFixed(2)}
          </div>
        </div>

        <p className="mt-2 text-[13px] text-white/75 font-medium line-clamp-2">
          {product.description}
        </p>

        <div className="mt-4 flex gap-3 pointer-events-auto">
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              triggerSwipe("left");
            }}
            className="flex-1 h-12 rounded-2xl flex items-center justify-center bg-white/10 backdrop-blur-xl border border-white/15 hover:bg-rose-500/40 transition-all active:scale-95"
            aria-label="Pass"
          >
            <X className="w-6 h-6 text-white" />
          </button>

          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              triggerSwipe("right");
            }}
            className="flex-1 h-12 rounded-2xl flex items-center justify-center text-white font-extrabold border border-white/10 shadow-lg transition-all active:scale-95"
            style={{ background: "var(--seligo-cta)" }}
            aria-label="Like"
          >
            <Heart className="w-6 h-6 text-white fill-current" />
          </button>
        </div>

        <div className="mt-3 text-[10px] font-extrabold uppercase tracking-[0.22em] text-white/55">
          Swipe to refine • Tap for details
        </div>
      </div>
    </div>
  );
};

export default SwipeCard;
