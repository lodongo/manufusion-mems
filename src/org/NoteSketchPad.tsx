import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, Loader2, Pen, Redo2, Trash2, Undo2, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Full-screen drawing canvas for notes: finger, stylus or mouse, pressure-aware strokes, colours,
// sizes, eraser, undo/redo. The drawing is returned as a PNG and embedded in the note body.
// ---------------------------------------------------------------------------

type Point = { x: number; y: number; p: number };
type CanvasPointer = { pointerId: number; currentTarget: HTMLCanvasElement; clientX: number; clientY: number; pressure: number; pointerType: string };
type Stroke = { color: string; size: number; erase: boolean; points: Point[] };
const COLORS = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#9333ea', '#ffffff'];
const SIZES = [2, 4, 8, 14];

export default function NoteSketchPad({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (png: Blob) => void }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const box = useRef<HTMLDivElement>(null);
    const [strokes, setStrokes] = useState<Stroke[]>([]);
    const [redo, setRedo] = useState<Stroke[]>([]);
    const [color, setColor] = useState(COLORS[0]);
    const [size, setSize] = useState(SIZES[1]);
    const [erase, setErase] = useState(false);
    const [paper, setPaper] = useState<'plain' | 'grid' | 'lines'>('plain');
    const current = useRef<Stroke | null>(null);

    const paint = useCallback(
        (list: Stroke[], live: Stroke | null = null) => {
            const c = canvas.current;
            if (!c) return;
            const ctx = c.getContext('2d');
            if (!ctx) return;
            const dpr = c.width / c.clientWidth || 1;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.scale(dpr, dpr);
            const w = c.clientWidth;
            const h = c.clientHeight;
            if (paper !== 'plain') {
                ctx.strokeStyle = '#e5e7eb';
                ctx.lineWidth = 1;
                for (let y = 28; y < h; y += 28) {
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(w, y);
                    ctx.stroke();
                }
                if (paper === 'grid')
                    for (let x = 28; x < w; x += 28) {
                        ctx.beginPath();
                        ctx.moveTo(x, 0);
                        ctx.lineTo(x, h);
                        ctx.stroke();
                    }
            }
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (const s of live ? [...list, live] : list) {
                ctx.strokeStyle = s.erase ? '#ffffff' : s.color;
                const pts = s.points;
                if (pts.length === 1) {
                    ctx.fillStyle = ctx.strokeStyle;
                    ctx.beginPath();
                    ctx.arc(pts[0].x, pts[0].y, (s.size * (0.5 + pts[0].p)) / 2, 0, Math.PI * 2);
                    ctx.fill();
                    continue;
                }
                for (let i = 1; i < pts.length; i++) {
                    const a = pts[i - 1];
                    const b = pts[i];
                    ctx.lineWidth = s.erase ? s.size * 3 : s.size * (0.5 + (a.p + b.p) / 2);
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    // Smooth with a midpoint curve.
                    const mx = (a.x + b.x) / 2;
                    const my = (a.y + b.y) / 2;
                    ctx.quadraticCurveTo(a.x, a.y, mx, my);
                    ctx.lineTo(b.x, b.y);
                    ctx.stroke();
                }
            }
        },
        [paper],
    );

    useEffect(() => {
        const resize = () => {
            const c = canvas.current;
            const b = box.current;
            if (!c || !b) return;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            c.width = Math.round(b.clientWidth * dpr);
            c.height = Math.round(b.clientHeight * dpr);
            c.style.width = b.clientWidth + 'px';
            c.style.height = b.clientHeight + 'px';
            paint(strokes);
        };
        resize();
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, [paint, strokes]);

    const pos = (e: { clientX: number; clientY: number; pressure: number; pointerType: string }): Point => {
        const r = canvas.current!.getBoundingClientRect();
        const p = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
        return { x: e.clientX - r.left, y: e.clientY - r.top, p };
    };
    const down = (e: CanvasPointer) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        current.current = { color, size, erase, points: [pos(e)] };
        paint(strokes, current.current);
    };
    const move = (e: CanvasPointer) => {
        if (!current.current) return;
        current.current.points.push(pos(e));
        paint(strokes, current.current);
    };
    const up = () => {
        if (!current.current) return;
        const done = current.current;
        current.current = null;
        setStrokes((s) => [...s, done]);
        setRedo([]);
    };
    const save = () => {
        const c = canvas.current;
        if (!c || !strokes.length) return;
        paint(strokes);
        c.toBlob((blob) => blob && onSave(blob), 'image/png');
    };

    return (
        <div className='fixed inset-0 z-[96] flex flex-col bg-[#f3f4f6] text-[#111827]' role='dialog' aria-modal='true' aria-label='Drawing canvas'>
            <header className='flex min-h-14 shrink-0 items-center gap-2 border-b border-[#e5e7eb] bg-[#ffffff] px-2 pt-[env(safe-area-inset-top)]'>
                <button type='button' aria-label='Cancel drawing' onClick={onCancel} className='flex h-11 w-11 items-center justify-center rounded-xl'>
                    <X className='h-5 w-5' />
                </button>
                <span className='flex-1 text-[15px] font-semibold'>Draw</span>
                <button type='button' aria-label='Undo' disabled={!strokes.length} onClick={() => { setRedo((r) => [...r, strokes[strokes.length - 1]]); setStrokes((s) => s.slice(0, -1)); }} className='flex h-11 w-11 items-center justify-center rounded-xl disabled:opacity-30'>
                    <Undo2 className='h-5 w-5' />
                </button>
                <button type='button' aria-label='Redo' disabled={!redo.length} onClick={() => { setStrokes((s) => [...s, redo[redo.length - 1]]); setRedo((r) => r.slice(0, -1)); }} className='flex h-11 w-11 items-center justify-center rounded-xl disabled:opacity-30'>
                    <Redo2 className='h-5 w-5' />
                </button>
                <button type='button' aria-label='Clear drawing' disabled={!strokes.length} onClick={() => { setRedo([]); setStrokes([]); }} className='flex h-11 w-11 items-center justify-center rounded-xl disabled:opacity-30'>
                    <Trash2 className='h-5 w-5' />
                </button>
                <button type='button' disabled={busy || !strokes.length} onClick={save} className='flex h-11 items-center gap-2 rounded-xl bg-[#059669] px-4 text-[14px] font-semibold text-[#ffffff] disabled:opacity-40'>
                    {busy && <Loader2 className='h-4 w-4 animate-spin' />} Insert
                </button>
            </header>
            <div ref={box} className='min-h-0 flex-1 overflow-hidden'>
                <canvas ref={canvas} className='block touch-none' style={{ cursor: erase ? 'cell' : 'crosshair' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label='Drawing area' />
            </div>
            <footer className='shrink-0 space-y-2 border-t border-[#e5e7eb] bg-[#ffffff] px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2'>
                <div className='flex items-center gap-2 overflow-x-auto'>
                    <button type='button' aria-label='Pen' aria-pressed={!erase} onClick={() => setErase(false)} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${!erase ? 'bg-[#d1fae5]' : ''}`}>
                        <Pen className='h-5 w-5' />
                    </button>
                    <button type='button' aria-label='Eraser' aria-pressed={erase} onClick={() => setErase(true)} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${erase ? 'bg-[#d1fae5]' : ''}`}>
                        <Eraser className='h-5 w-5' />
                    </button>
                    <span className='mx-1 h-6 w-px shrink-0 bg-[#e5e7eb]' />
                    {COLORS.map((c) => (
                        <button key={c} type='button' aria-label={'Colour ' + c} aria-pressed={color === c && !erase} onClick={() => { setColor(c); setErase(false); }} className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full'>
                            <span className='h-7 w-7 rounded-full border-2' style={{ background: c, borderColor: color === c && !erase ? '#059669' : '#d1d5db' }} />
                        </button>
                    ))}
                </div>
                <div className='flex items-center gap-2'>
                    {SIZES.map((s) => (
                        <button key={s} type='button' aria-label={'Stroke ' + s} aria-pressed={size === s} onClick={() => setSize(s)} className={`flex h-10 w-10 items-center justify-center rounded-full ${size === s ? 'bg-[#d1fae5]' : ''}`}>
                            <span className='rounded-full bg-[#111827]' style={{ width: s + 2, height: s + 2 }} />
                        </button>
                    ))}
                    <span className='flex-1' />
                    {(['plain', 'lines', 'grid'] as const).map((k) => (
                        <button key={k} type='button' aria-pressed={paper === k} onClick={() => setPaper(k)} className={`h-9 rounded-full px-3 text-[12px] font-medium ${paper === k ? 'bg-[#d1fae5] text-[#065f46]' : 'text-[#6b7280]'}`}>
                            {k === 'plain' ? 'Plain' : k === 'lines' ? 'Lined' : 'Grid'}
                        </button>
                    ))}
                </div>
            </footer>
        </div>
    );
}
