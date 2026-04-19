import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform, MotionValue } from 'framer-motion';
import sopDataRaw from '../doc/SOP_v3.0/SOP_v3.0.json';

// ---- types ----
interface SopItem {
  风格名称: string;
  '风格名称（英）': string;
  正向提示词: string;
  '提示词（中）': string;
  反向提示词: string;
  '反向提示词（中）': string;
  采纳建议: string;
}
type SopData = Record<string, SopItem[]>;
const sopData = sopDataRaw as SopData;

// ---- images ----
const imageModules = import.meta.glob('../image/*/*.png', { eager: true, as: 'url' });

interface ImageEntry {
  src: string;
  category: string;
  name: string;
  data: SopItem | null;
}

const CATEGORY_ORDER = Object.keys(sopData);
const ITEM_WIDTH = 144;
const LEFT_PAD_RATIO = 0.35;

function computeBounds(winWidth: number) {
  const maxScroll = winWidth / 3;
  const minScroll = winWidth * (0.5 - LEFT_PAD_RATIO) - (IMAGES.length - 0.5) * ITEM_WIDTH;
  return { minScroll, maxScroll };
}

function scrollToIndex(idx: number, scrollX: MotionValue<number>) {
  const winWidth = window.innerWidth;
  // The strip starts at x=smoothScrollX, left padding = winWidth * LEFT_PAD_RATIO
  // Item idx center is at: smoothScrollX + winWidth * LEFT_PAD_RATIO + idx * ITEM_WIDTH + ITEM_WIDTH/2
  // We want that to equal winWidth/2  →  smoothScrollX = winWidth/2 - winWidth*LEFT_PAD_RATIO - idx*ITEM_WIDTH - ITEM_WIDTH/2
  const target = winWidth / 2 - winWidth * LEFT_PAD_RATIO - idx * ITEM_WIDTH - ITEM_WIDTH / 2;
  const { minScroll, maxScroll } = computeBounds(winWidth);
  scrollX.set(Math.min(Math.max(target, minScroll), maxScroll));
}

const buildEntries = (): ImageEntry[] => {
  const available: Record<string, Record<string, string>> = {};
  for (const [path, url] of Object.entries(imageModules)) {
    const parts = path.replace('../image/', '').split('/');
    if (parts.length !== 2) continue;
    const [cat, file] = parts;
    const name = file.replace(/\.png$/i, '');
    if (!available[cat]) available[cat] = {};
    available[cat][name] = url as string;
  }
  const entries: ImageEntry[] = [];
  for (const cat of CATEGORY_ORDER) {
    const items = sopData[cat];
    const catImages = available[cat] ?? {};
    for (const item of items) {
      const en = item['风格名称（英）'];
      if (catImages[en]) entries.push({ src: catImages[en], category: cat, name: en, data: item });
    }
    for (const [name, src] of Object.entries(catImages)) {
      if (!items.some(i => i['风格名称（英）'] === name))
        entries.push({ src, category: cat, name, data: null });
    }
  }
  for (const [cat, imgs] of Object.entries(available)) {
    if (CATEGORY_ORDER.includes(cat)) continue;
    for (const [name, src] of Object.entries(imgs))
      entries.push({ src, category: cat, name, data: null });
  }
  return entries;
};

const IMAGES: ImageEntry[] = buildEntries();

// category → first index in IMAGES
const CATEGORY_FIRST_INDEX: Record<string, number> = {};
IMAGES.forEach((entry, i) => {
  if (!(entry.category in CATEGORY_FIRST_INDEX)) CATEGORY_FIRST_INDEX[entry.category] = i;
});

// ---- Slice ----
interface SliceProps {
  entry: ImageEntry;
  mouseX: MotionValue<number>;
  onSelect: () => void;
}

const ArchivalSlice: React.FC<SliceProps> = ({ entry, mouseX, onSelect }) => {
  const ref = useRef<HTMLDivElement>(null);

  const distance = useTransform(mouseX, (val) => {
    if (val === -1000) return 9999;
    const bounds = ref.current?.getBoundingClientRect();
    if (!bounds) return 9999;
    return val - (bounds.left + bounds.width / 2);
  });

  const widthSync = useTransform(distance, [-300, 0, 300], [144, 240, 144]);
  const width = useSpring(widthSync, { stiffness: 180, damping: 25 });
  const scaleSync = useTransform(distance, [-300, 0, 300], [0.8, 1, 0.8]);
  const scale = useSpring(scaleSync, { stiffness: 180, damping: 25 });
  const zIndexSync = useTransform(distance, [-300, 0, 300], [10, 100, 10]);
  const zIndex = useTransform(zIndexSync, (v) => Math.round(v));
  const fontSizeSync = useTransform(distance, [-300, 0, 300], [9, 14, 9]);
  const fontSize = useSpring(fontSizeSync, { stiffness: 180, damping: 25 });

  const labelText = `${entry.category}＿${entry.data?.['风格名称'] ?? entry.name}`;

  return (
    <motion.div
      ref={ref}
      style={{ width, scale, zIndex, transformOrigin: 'bottom' }}
      className="relative flex-shrink-0 h-[65vh] bg-white border-l border-neutral-200/50 cursor-pointer overflow-hidden group shadow-[1px_0_10px_rgba(0,0,0,0.02)]"
      onClick={onSelect}
    >
      <div className="w-full h-full relative bg-neutral-100">
        <motion.img
          src={entry.src}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          alt={entry.name}
        />
        {/* Auto-contrast label via mix-blend-mode: difference */}
        <motion.div
          className="absolute top-5 left-1/2 -translate-x-1/2 vertical-text song-ti select-none pointer-events-none"
          style={{
            fontSize,
            letterSpacing: '0.15em',
            color: 'white',
            mixBlendMode: 'difference',
            opacity: 0.9,
            whiteSpace: 'nowrap',
          }}
        >
          {labelText}
        </motion.div>
      </div>
    </motion.div>
  );
};

// ---- Category Nav (top-right) ----
const CategoryNav: React.FC<{
  scrollX: MotionValue<number>;
  activeCategory: string;
}> = ({ scrollX, activeCategory }) => (
  <div className="fixed top-10 right-12 z-[60] flex flex-col items-end gap-[6px]">
    {CATEGORY_ORDER.map((cat) => {
      const isActive = activeCategory === cat;
      return (
        <button
          key={cat}
          onClick={() => scrollToIndex(CATEGORY_FIRST_INDEX[cat] ?? 0, scrollX)}
          className="song-ti transition-all duration-300"
          style={{
            fontSize: 13,
            letterSpacing: '0.25em',
            color: isActive ? '#404040' : '#b0b0b0',
            fontWeight: isActive ? 600 : 400,
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            padding: '0 0 0 8px',
            borderRight: isActive ? '2px solid #404040' : '2px solid transparent',
            outline: 'none',
          }}
        >
          {cat}
        </button>
      );
    })}
  </div>
);

// ---- Detail Panel ----
const DetailPanel: React.FC<{ entry: ImageEntry; onClose: () => void }> = ({ entry, onClose }) => {
  const { data } = entry;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] overflow-y-auto bg-white/98 backdrop-blur-2xl"
      onClick={onClose}
    >
      <div className="min-h-full flex items-center justify-center p-6 py-10">
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          className="relative max-w-6xl w-full bg-white border border-neutral-100 shadow-[0_30px_90px_rgba(0,0,0,0.05)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-4 sm:p-10">
            <div className="relative aspect-[16/9] overflow-hidden bg-neutral-50 border border-neutral-100">
              <img src={entry.src} className="w-full h-full object-cover" alt={entry.name} />
            </div>
            <div className="mt-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-neutral-100 pb-6">
              <div>
                <p className="text-[9px] font-mono text-neutral-400 uppercase tracking-widest mb-1">
                  {entry.category} / {data ? data['风格名称（英）'] : entry.name}
                </p>
                <h2 className="text-2xl font-extralight tracking-tight text-neutral-800 leading-none">
                  {data ? data['风格名称'] : entry.name}
                </h2>
              </div>
              <button
                onClick={onClose}
                className="group flex items-center gap-3 text-[10px] font-mono text-neutral-400 uppercase tracking-[0.3em] hover:text-black transition-all flex-shrink-0"
              >
                返回库
                <div className="w-7 h-7 border border-neutral-200 rounded-full flex items-center justify-center group-hover:border-black group-hover:rotate-90 transition-all duration-500 text-xs">
                  ✕
                </div>
              </button>
            </div>
            {data ? (
              <div className="mt-6 flex flex-col gap-4">
                {/* 正向提示词：左英右中 */}
                <div>
                  <label className="text-[8px] font-mono text-neutral-400 uppercase tracking-[0.25em] block mb-2">正向提示词</label>
                  <div className="grid grid-cols-2 gap-0 border border-neutral-100 overflow-hidden">
                    <div className="bg-neutral-50 p-4 font-mono text-xs text-neutral-700 leading-relaxed break-all border-r border-neutral-100">
                      {data['正向提示词']}
                    </div>
                    <div className="bg-neutral-50 p-4 text-xs text-neutral-500 leading-relaxed">
                      {data['提示词（中）']}
                    </div>
                  </div>
                </div>
                {/* 反向提示词：左英右中 */}
                <div>
                  <label className="text-[8px] font-mono text-red-300 uppercase tracking-[0.25em] block mb-2">反向提示词</label>
                  <div className="grid grid-cols-2 gap-0 border border-red-100/60 overflow-hidden">
                    <div className="bg-red-50/40 p-4 font-mono text-xs text-neutral-600 leading-relaxed break-all border-r border-red-100/60">
                      {data['反向提示词']}
                    </div>
                    <div className="bg-red-50/40 p-4 text-xs text-neutral-500 leading-relaxed">
                      {data['反向提示词（中）']}
                    </div>
                  </div>
                </div>
                {/* 采纳建议 */}
                <div>
                  <label className="text-[8px] font-mono text-neutral-400 uppercase tracking-[0.25em] block mb-2">采纳建议</label>
                  <div className="bg-neutral-50 border border-neutral-100 p-4 text-xs text-neutral-600 leading-relaxed">
                    {data['采纳建议']}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 text-xs text-neutral-400 font-mono">暂无提示词数据</div>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

// ---- Draggable Progress Bar ----
const BAR_W = 256;
const DOT_R = 5;

const ProgressBar: React.FC<{ scrollX: MotionValue<number> }> = ({ scrollX }) => {
  const barRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dotX = useMotionValue(0);

  useEffect(() => {
    const syncDot = (val: number) => {
      if (isDragging.current) return;
      const { minScroll, maxScroll } = computeBounds(window.innerWidth);
      const p = Math.min(1, Math.max(0, (maxScroll - val) / (maxScroll - minScroll)));
      dotX.set(p * BAR_W);
    };
    syncDot(scrollX.get());
    return scrollX.on('change', syncDot);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current || !barRef.current) return;
      const rect = barRef.current.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      dotX.set(p * BAR_W);
      const { minScroll, maxScroll } = computeBounds(window.innerWidth);
      scrollX.set(maxScroll - p * (maxScroll - minScroll));
    };
    const onUp = () => { isDragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const dotLeft = useTransform(dotX, v => v - DOT_R);

  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    dotX.set(p * BAR_W);
    const { minScroll, maxScroll } = computeBounds(window.innerWidth);
    scrollX.set(maxScroll - p * (maxScroll - minScroll));
  };

  return (
    <div
      ref={barRef}
      className="fixed bottom-12 left-12 cursor-pointer"
      style={{ width: BAR_W, height: DOT_R * 2 + 4 }}
      onClick={handleBarClick}
    >
      <div className="absolute bg-neutral-200" style={{ left: 0, right: 0, top: '50%', height: 1, transform: 'translateY(-50%)' }} />
      <motion.div className="absolute bg-neutral-400" style={{ left: 0, width: dotX, top: '50%', height: 1, transform: 'translateY(-50%)' }} />
      <motion.div
        className="absolute rounded-full bg-neutral-600"
        style={{ left: dotLeft, top: '50%', width: DOT_R * 2, height: DOT_R * 2, y: '-50%', cursor: 'grab' }}
        onMouseDown={(e) => { isDragging.current = true; e.preventDefault(); e.stopPropagation(); }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
};

// ---- Gallery ----
const Gallery = () => {
  const [selected, setSelected] = useState<number | null>(null);
  const [activeCategory, setActiveCategory] = useState(CATEGORY_ORDER[0]);
  const mouseX = useMotionValue(-1000);
  const scrollX = useMotionValue(0);
  const smoothScrollX = useSpring(scrollX, { stiffness: 80, damping: 24 });

  // Track active category from scroll position
  useEffect(() => {
    const updateActive = (val: number) => {
      const winWidth = window.innerWidth;
      const centerIdx = Math.round(
        (winWidth / 2 - val - winWidth * LEFT_PAD_RATIO - ITEM_WIDTH / 2) / ITEM_WIDTH
      );
      const clamped = Math.max(0, Math.min(IMAGES.length - 1, centerIdx));
      const cat = IMAGES[clamped]?.category;
      if (cat) setActiveCategory(cat);
    };
    updateActive(scrollX.get());
    return scrollX.on('change', updateActive);
  }, []);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (selected !== null) return;
      e.preventDefault();
      const delta = e.deltaY || e.deltaX;
      const newScroll = scrollX.get() - delta * 1.8;
      const { minScroll, maxScroll } = computeBounds(window.innerWidth);
      scrollX.set(Math.min(Math.max(newScroll, minScroll), maxScroll));
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [selected]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (selected !== null) return;
    mouseX.set(e.pageX);
  };
  const handleMouseLeave = () => mouseX.set(-1000);

  return (
    <main
      className="relative w-screen h-screen bg-[#FBFBFB] overflow-hidden flex flex-col justify-center"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Top-left title */}
      <div className="absolute top-10 left-12 z-20 pointer-events-none">
        <h1 className="song-ti tracking-[0.35em] text-neutral-500 leading-loose" style={{ fontSize: 15 }}>
          AIGC提示词语料库构建在建筑插画风格中的运用
        </h1>
        <p className="song-ti tracking-[0.35em] text-neutral-400 mt-1" style={{ fontSize: 13 }}>
          答辩者：刘雪嵩　　指导教师：姚乐飞
        </p>
      </div>

      {/* Top-right category nav */}
      <CategoryNav scrollX={scrollX} activeCategory={activeCategory} />

      <motion.div
        style={{ x: smoothScrollX }}
        className="flex items-end h-[75vh] px-[35vw]"
      >
        {IMAGES.map((entry, i) => (
          <ArchivalSlice
            key={i}
            entry={entry}
            mouseX={mouseX}
            onSelect={() => setSelected(i)}
          />
        ))}
      </motion.div>

      <ProgressBar scrollX={scrollX} />

      <AnimatePresence>
        {selected !== null && (
          <DetailPanel entry={IMAGES[selected]} onClose={() => setSelected(null)} />
        )}
      </AnimatePresence>

      {/* Bottom-right hint */}
      <div className="fixed bottom-10 right-12 text-right pointer-events-none">
        <p className="song-ti tracking-[0.3em] text-neutral-400" style={{ fontSize: 13 }}>
          滚轮横向浏览<br />
          点击查看详情
        </p>
      </div>

      <style>{`
        .vertical-text {
          writing-mode: vertical-rl;
          text-orientation: mixed;
        }
        .song-ti {
          font-family: SimSun, 'STSong', 'Songti SC', 'FangSong', serif;
        }
        body {
          background: #FBFBFB !important;
          cursor: crosshair;
        }
      `}</style>
    </main>
  );
};

const App = () => <Gallery />;
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
