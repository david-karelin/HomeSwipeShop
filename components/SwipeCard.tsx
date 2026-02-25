
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
          <Heart className="w-12 h-12 text-emerald-500 fill-current" />
        </div>
        <div>
          <h3 className="text-3xl font-black text-slate-900 tracking-tight">Style Match!</h3>
          <p className="text-slate-500 mt-2 font-medium">Keep "{product.name}" in your collection?</p>
        </div>
        <div className="grid grid-cols-2 gap-4 w-full pt-4">
          <button
            onClick={() => onSelectAction('wishlist')}
            className="flex flex-col items-center justify-center p-6 bg-slate-50 hover:bg-indigo-50 border border-slate-100 rounded-3xl transition-all group"
          >
            <Bookmark className="w-8 h-8 text-slate-400 group-hover:text-indigo-500 mb-2 transition-transform group-hover:scale-110" />
            <span className="text-xs font-black uppercase tracking-widest text-slate-500 group-hover:text-indigo-600">Wishlist</span>
          </button>
          <button
            onClick={() => onSelectAction('cart')}
            className="flex flex-col items-center justify-center p-6 bg-slate-50 hover:bg-emerald-50 border border-slate-100 rounded-3xl transition-all group"
          >
            <ShoppingCart className="w-8 h-8 text-slate-400 group-hover:text-emerald-500 mb-2 transition-transform group-hover:scale-110" />
            <span className="text-xs font-black uppercase tracking-widest text-slate-500 group-hover:text-emerald-600">Add to Bag</span>
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
      style={{
        transform: `translate3d(${offset.x}px, ${offset.y}px, 0) rotate(${rotation}deg) scale(${isDragging ? 1.05 : 1})`,
        transition: isDragging ? 'none' : 'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease',
        touchAction: 'none',
        cursor: isDragging ? 'grabbing' : 'grab'
      }}
      className={`relative w-full max-w-sm aspect-[3/4] bg-white rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.2)] overflow-hidden select-none touch-none
        ${isSwiping ? 'opacity-0 scale-90' : 'opacity-100'}
      `}
    >
      <img 
        src={product.imageUrl} 
        alt={product.name}
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent pointer-events-none" />
      
      {/* Visual Cues */}
      <div 
        style={{ opacity: opacityLike }}
        className="absolute top-12 left-10 border-4 border-emerald-500 rounded-2xl px-6 py-2 rotate-[-15deg] pointer-events-none z-20 bg-emerald-500/10 backdrop-blur-sm"
      >
        <span className="text-emerald-500 text-5xl font-black uppercase tracking-tighter">LIKE</span>
      </div>
      <div 
        style={{ opacity: opacityNope }}
        className="absolute top-12 right-10 border-4 border-rose-500 rounded-2xl px-6 py-2 rotate-[15deg] pointer-events-none z-20 bg-rose-500/10 backdrop-blur-sm"
      >
        <span className="text-rose-500 text-5xl font-black uppercase tracking-tighter">PASS</span>
      </div>

      {/* Content */}
      <div className="absolute bottom-0 left-0 right-0 p-8 text-white pointer-events-none">
        <div className="flex justify-between items-end mb-3">
          <div className="max-w-[70%]">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 mb-1 block">
              {product.brand}
            </span>
            <h2 className="text-3xl font-black leading-tight drop-shadow-lg">{product.name}</h2>
          </div>
          <div className="text-2xl font-black text-emerald-400 mb-1 drop-shadow-lg">${product.price}</div>
        </div>
        <p className="text-sm text-slate-300 font-medium line-clamp-2 mb-6 opacity-80">{product.description}</p>
        
        {/* Expanded Action Bar */}
        <div className="flex flex-col gap-3 pointer-events-auto">
          {/* Core Tinder Actions */}
          <div className="flex justify-between items-center gap-4">
            <button 
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); triggerSwipe('left'); }}
              className="flex-1 py-4 bg-white/10 backdrop-blur-xl rounded-2xl flex items-center justify-center hover:bg-rose-500/60 transition-all border border-white/20 active:scale-90"
            >
              <X className="w-8 h-8 text-white" />
            </button>
            <button 
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); triggerSwipe('right'); }}
              className="flex-1 py-4 bg-indigo-600 rounded-2xl flex items-center justify-center hover:bg-indigo-500 transition-all shadow-xl active:scale-90 border border-white/10"
            >
              <Heart className="w-8 h-8 text-white fill-current" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SwipeCard;
