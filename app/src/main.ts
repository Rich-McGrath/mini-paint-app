import './styles/base.css';
import { fetchCutout, fetchOriginal, segmentImage, uploadImage, uploadMask } from './lib/api';
import { alphaBBox, padBBox, type BBox } from './lib/cutout';
import { replayOps, type Op } from './lib/editor';
import { correctLighting } from './lib/lighting';

/* M3: the correction editor (design/EditorPhone.dc.html, dock variant).
 * Cutout shown immediately; correction is optional polish, never a gate.
 * Tools in frequency order: trim line → tap-to-remove → brush → edge loupe.
 * All edits are non-destructive ops over the mask; undo pops one. */

const EDIT_DIM = 1280; // interactive resolution
const EXPORT_DIM = 2048; // export resolution (ops replay there)
const TRIM_KEY = 'ss-trim'; // remembered trim line (same pot next time)

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing #app root');

type Tool = 'trim' | 'tap' | 'brush' | 'loupe';
type BgKey = 'black' | 'grey' | 'white';
const BG: Record<BgKey, string> = { black: '#000000', grey: '#777777', white: '#FFFFFF' };

interface EditSession {
  id: string;
  fileName: string;
  width: number;
  height: number;
  origRgba: Uint8ClampedArray; // original photo at edit resolution
  baseAlpha: Uint8Array; // the API's mask
  origBitmap: ImageBitmap; // full-res sources for export
  cutoutBitmap: ImageBitmap;
  ops: Op[];
  // derived by recompute():
  alpha: Uint8Array;
  corrected: Uint8ClampedArray;
  crop: BBox;
  beforeCanvas: HTMLCanvasElement;
  subjectCanvas: HTMLCanvasElement; // corrected subject, transparent background
}

interface State {
  screen: 'upload' | 'processing' | 'edit' | 'error';
  message: string;
  session: EditSession | null;
  tool: Tool | null;
  bg: BgKey;
  brushMode: 'add' | 'erase';
  brushRadius: number; // fraction of image width
  trimFrac: number; // current trim-line position (fraction of full image height)
  reveal: boolean; // play the before/after reveal on next edit render
  sheet: boolean; // download sheet
  busy: boolean;
}

const state: State = {
  screen: 'upload',
  message: '',
  session: null,
  tool: null,
  bg: 'black',
  brushMode: 'add',
  brushRadius: 0.012,
  trimFrac: 0.9,
  reveal: false,
  sheet: false,
  busy: false
};

function set(patch: Partial<State>): void {
  Object.assign(state, patch);
  render();
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string): void {
  document.querySelector('[data-role=toast]')?.remove();
  const el = html(`<div data-role="toast" style="position:fixed;left:50%;transform:translateX(-50%);
    bottom:140px;z-index:50;padding:8px 16px;border-radius:999px;background:var(--surface-raised);
    border:1px solid var(--border-strong);font-size:var(--text-sm);color:var(--text-primary);
    box-shadow:0 4px 16px rgba(0,0,0,0.4);white-space:nowrap;">${escapeHtml(message)}</div>`);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 1800);
}

/* ---------- processing ---------- */

async function processFile(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) {
    set({ screen: 'error', message: 'That file is not an image.' });
    return;
  }
  set({ screen: 'processing', message: 'Removing background…' });
  try {
    const id = await uploadImage(file);
    await segmentImage(id);
    set({ message: 'Correcting lighting…' });
    const [cutout, original] = await Promise.all([fetchCutout(id), fetchOriginal(id)]);
    const session = await openSession(id, file.name, original, cutout);
    recompute(session);
    set({ screen: 'edit', session, tool: null, reveal: true, sheet: false });
  } catch (err) {
    set({
      screen: 'error',
      message: err instanceof Error ? err.message : 'Something went wrong. Please try again.'
    });
  }
}

function scaledContext(
  bitmap: ImageBitmap,
  width: number,
  height: number
): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx;
}

async function openSession(
  id: string,
  fileName: string,
  originalBlob: Blob,
  cutoutBlob: Blob
): Promise<EditSession> {
  const cutoutBitmap = await createImageBitmap(cutoutBlob);
  const origBitmap = await createImageBitmap(originalBlob);
  const scale = Math.min(1, EDIT_DIM / Math.max(cutoutBitmap.width, cutoutBitmap.height));
  const width = Math.round(cutoutBitmap.width * scale);
  const height = Math.round(cutoutBitmap.height * scale);

  const origRgba = scaledContext(origBitmap, width, height).getImageData(0, 0, width, height).data;
  const cutRgba = scaledContext(cutoutBitmap, width, height).getImageData(0, 0, width, height).data;
  const baseAlpha = new Uint8Array(width * height);
  for (let p = 0; p < baseAlpha.length; p++) baseAlpha[p] = cutRgba[p * 4 + 3]!;

  return {
    id,
    fileName,
    width,
    height,
    origRgba,
    baseAlpha,
    origBitmap,
    cutoutBitmap,
    ops: [],
    alpha: baseAlpha,
    corrected: new Uint8ClampedArray(0),
    crop: { x0: 0, y0: 0, x1: width, y1: height },
    beforeCanvas: document.createElement('canvas'),
    subjectCanvas: document.createElement('canvas')
  };
}

/** Rebuild everything derived from (base mask + ops): effective alpha, lighting
 * correction, crop, and the before/subject canvases. */
function recompute(s: EditSession): void {
  const { width: w, height: h } = s;
  s.alpha = replayOps(s.baseAlpha, w, h, s.ops);

  // Working subject: original colours under the effective mask — this is what
  // lets the add-brush restore pixels the segmentation cut away.
  const subject = new Uint8ClampedArray(s.origRgba);
  for (let p = 0; p < s.alpha.length; p++) subject[p * 4 + 3] = s.alpha[p]!;

  s.corrected = correctLighting(subject, s.origRgba, w, h).rgba;
  const box = alphaBBox(s.corrected, w, h);
  s.crop = box ? padBBox(box, w, h) : { x0: 0, y0: 0, x1: w, y1: h };

  const cw = s.crop.x1 - s.crop.x0;
  const ch = s.crop.y1 - s.crop.y0;

  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  full.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(s.corrected), w, h), 0, 0);

  s.subjectCanvas.width = cw;
  s.subjectCanvas.height = ch;
  s.subjectCanvas.getContext('2d')!.drawImage(full, s.crop.x0, s.crop.y0, cw, ch, 0, 0, cw, ch);

  const orig = document.createElement('canvas');
  orig.width = w;
  orig.height = h;
  orig.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(s.origRgba), w, h), 0, 0);
  s.beforeCanvas.width = cw;
  s.beforeCanvas.height = ch;
  s.beforeCanvas.getContext('2d')!.drawImage(orig, s.crop.x0, s.crop.y0, cw, ch, 0, 0, cw, ch);
}

function commitOp(op: Op): void {
  const s = state.session;
  if (!s) return;
  s.ops.push(op);
  recompute(s);
  render();
}

function undo(): void {
  const s = state.session;
  if (!s) return;
  if (s.ops.length === 0) {
    toast('Nothing to undo');
    return;
  }
  s.ops.pop();
  recompute(s);
  render();
  toast('Undone');
}

/* ---------- export + flywheel ---------- */

async function exportPng(): Promise<Blob> {
  const s = state.session;
  if (!s) throw new Error('no session');
  const scale = Math.min(1, EXPORT_DIM / Math.max(s.cutoutBitmap.width, s.cutoutBitmap.height));
  const w = Math.round(s.cutoutBitmap.width * scale);
  const h = Math.round(s.cutoutBitmap.height * scale);

  const origRgba = scaledContext(s.origBitmap, w, h).getImageData(0, 0, w, h).data;
  const cutRgba = scaledContext(s.cutoutBitmap, w, h).getImageData(0, 0, w, h).data;
  const base = new Uint8Array(w * h);
  for (let p = 0; p < base.length; p++) base[p] = cutRgba[p * 4 + 3]!;
  const alpha = replayOps(base, w, h, s.ops); // same ops, export resolution

  const subject = new Uint8ClampedArray(origRgba);
  for (let p = 0; p < alpha.length; p++) subject[p * 4 + 3] = alpha[p]!;
  const corrected = correctLighting(subject, origRgba, w, h).rgba;

  const box = alphaBBox(corrected, w, h);
  const crop = box ? padBBox(box, w, h) : { x0: 0, y0: 0, x1: w, y1: h };

  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  full.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(corrected), w, h), 0, 0);

  const out = document.createElement('canvas');
  out.width = crop.x1 - crop.x0;
  out.height = crop.y1 - crop.y0;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#000000'; // exports on black, always
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(full, crop.x0, crop.y0, out.width, out.height, 0, 0, out.width, out.height);

  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('export failed'))), 'image/png')
  );
}

/** Every correction is a human-verified mask (SPEC §9). Downscaled, greyscale,
 * quietly — never in the way of the download. */
function sendCorrectedMask(): void {
  const s = state.session;
  if (!s || s.ops.length === 0) return;
  try {
    const scale = Math.min(1, 1024 / Math.max(s.width, s.height));
    const mw = Math.round(s.width * scale);
    const mh = Math.round(s.height * scale);
    const full = document.createElement('canvas');
    full.width = s.width;
    full.height = s.height;
    const img = full.getContext('2d')!.createImageData(s.width, s.height);
    for (let p = 0; p < s.alpha.length; p++) {
      const v = s.alpha[p]!;
      img.data[p * 4] = v;
      img.data[p * 4 + 1] = v;
      img.data[p * 4 + 2] = v;
      img.data[p * 4 + 3] = 255;
    }
    full.getContext('2d')!.putImageData(img, 0, 0);
    const small = document.createElement('canvas');
    small.width = mw;
    small.height = mh;
    small.getContext('2d')!.drawImage(full, 0, 0, mw, mh);
    small.toBlob((b) => {
      if (b) void uploadMask(s.id, b).catch(() => undefined);
    }, 'image/png');
  } catch {
    /* flywheel must never break the user's flow */
  }
}

async function downloadResult(): Promise<void> {
  set({ busy: true });
  try {
    const blob = await exportPng();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'studioshot.png';
    a.click();
    URL.revokeObjectURL(a.href);
    sendCorrectedMask();
    set({ busy: false, sheet: false });
    toast('Saved');
  } catch {
    set({ busy: false });
    toast('Export failed — try again');
  }
}

/* ---------- geometry helpers ---------- */

/** Rect of the contained (object-fit) image inside the frame, frame-relative. */
function imageRect(frame: HTMLElement, s: EditSession) {
  const fw = frame.clientWidth;
  const fh = frame.clientHeight;
  const cw = s.crop.x1 - s.crop.x0;
  const ch = s.crop.y1 - s.crop.y0;
  const k = Math.min(fw / cw, fh / ch);
  const w = cw * k;
  const h = ch * k;
  return { left: (fw - w) / 2, top: (fh - h) / 2, width: w, height: h };
}

/** Frame-relative pointer position → normalised full-image coordinates. */
function toImageCoords(frame: HTMLElement, s: EditSession, clientX: number, clientY: number) {
  const fr = frame.getBoundingClientRect();
  const r = imageRect(frame, s);
  const cx = s.crop.x0 + ((clientX - fr.left - r.left) / r.width) * (s.crop.x1 - s.crop.x0);
  const cy = s.crop.y0 + ((clientY - fr.top - r.top) / r.height) * (s.crop.y1 - s.crop.y0);
  return { x: cx / s.width, y: cy / s.height, rect: r };
}

/* ---------- render ---------- */

function render(): void {
  if (!app) return;
  app.replaceChildren();
  if (state.screen === 'upload' || state.screen === 'error') renderUpload();
  else if (state.screen === 'processing') renderProcessing();
  else renderEdit();
}

function renderUpload(): void {
  app!.append(
    html(`<div style="min-height:100dvh;display:flex;flex-direction:column;">
      <header style="padding:var(--space-4) var(--space-4) 0;text-align:center;font-size:var(--text-sm);
        font-weight:var(--weight-bold);letter-spacing:0.12em;color:var(--text-secondary);">STUDIOSHOT</header>
      <main style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
        gap:var(--space-3);padding:0 var(--space-8);text-align:center;">
        <h1 style="margin:0;font-size:var(--text-xl);font-weight:var(--weight-bold);line-height:1.2;">
          Shot at your desk.</h1>
        <p style="margin:0;font-size:var(--text-md);color:var(--text-secondary);">
          Background removed, lighting fixed. Ready to post.</p>
        ${
          state.screen === 'error'
            ? `<p data-role="error" style="margin:0;font-size:var(--text-sm);color:var(--danger);">${escapeHtml(state.message)}</p>`
            : ''
        }
        <button data-action="choose" style="margin-top:var(--space-4);height:50px;padding:0 var(--space-8);
          border-radius:var(--radius-control);background:var(--accent);border:none;color:var(--canvas);
          font-size:var(--text-md);font-weight:var(--weight-medium);">Choose photo</button>
        <p style="margin:0;font-size:var(--text-xs);color:var(--text-tertiary);">Your original is never modified</p>
      </main>
      <footer style="padding:0 var(--space-4) var(--space-6);text-align:center;">
        <a href="/terms.html" style="font-size:var(--text-xs);color:var(--text-tertiary);">Terms — how your images are used</a>
      </footer>
    </div>`)
  );
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    if (input.files?.[0]) void processFile(input.files[0]);
  };
  app!.querySelector('[data-action=choose]')?.addEventListener('click', () => input.click());
}

function renderProcessing(): void {
  app!.append(
    html(`<div style="min-height:100dvh;display:flex;align-items:flex-end;padding:var(--space-3);">
      <div style="flex:1;background:var(--surface);border:1px solid var(--border-strong);
        border-radius:var(--radius-card);padding:var(--space-4);margin-bottom:var(--space-3);">
        <div style="font-size:var(--text-sm);">${escapeHtml(state.message)}</div>
        <div style="margin-top:var(--space-3);height:2px;border-radius:1px;background:var(--border);
          overflow:hidden;position:relative;">
          <div style="position:absolute;top:0;bottom:0;width:40%;background:var(--accent);
            animation:ss-bar 1.1s linear infinite;"></div>
        </div>
      </div>
    </div>`)
  );
}

const TOOL_DEFS: Array<{ key: Tool; label: string }> = [
  { key: 'trim', label: 'Trim' },
  { key: 'tap', label: 'Remove' },
  { key: 'brush', label: 'Brush' },
  { key: 'loupe', label: 'Edges' }
];

function renderEdit(): void {
  const s = state.session!;
  const tool = state.tool;

  const shell = html(`<div style="height:100dvh;display:flex;flex-direction:column;">
    <header style="display:flex;align-items:center;height:52px;padding:0 var(--space-2);flex:none;">
      <button data-action="back" aria-label="Start over" style="width:44px;height:44px;background:none;
        border:none;color:var(--text-secondary);font-size:var(--text-xl);line-height:1;">‹</button>
      <div style="flex:1;text-align:center;font-size:var(--text-sm);color:var(--text-tertiary);
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.fileName)}</div>
      <button data-action="save" style="height:44px;padding:0 var(--space-3);background:none;border:none;
        color:var(--accent);font-size:var(--text-md);font-weight:var(--weight-medium);">Save</button>
    </header>

    <main style="flex:1;display:flex;padding:0 var(--space-3);min-height:0;">
      <div data-role="frame" style="position:relative;flex:1;border-radius:var(--radius-frame);
        border:1px solid var(--border);overflow:hidden;background:${BG[state.bg]};touch-action:none;"></div>
    </main>

    <footer style="flex:none;padding:var(--space-2) var(--space-4) var(--space-3);display:flex;
      flex-direction:column;gap:var(--space-2);">
      <div style="display:flex;align-items:center;justify-content:center;gap:var(--space-2);">
        <span style="font-size:var(--text-xs);color:var(--text-tertiary);margin-right:var(--space-1);">Background</span>
        ${(['black', 'grey', 'white'] as BgKey[])
          .map(
            (k) => `<button data-bg="${k}" aria-label="${k} background" style="width:44px;height:44px;
              border-radius:50%;background:none;border:none;display:flex;align-items:center;justify-content:center;padding:0;">
              <span style="display:block;width:24px;height:24px;border-radius:50%;background:${BG[k]};
                border:2px solid ${state.bg === k ? 'var(--accent)' : 'var(--border-strong)'};"></span></button>`
          )
          .join('')}
      </div>
      <div style="display:flex;gap:var(--space-2);">
        ${TOOL_DEFS.map(
          (t) => `<button data-tool="${t.key}" style="flex:1;height:48px;border-radius:var(--radius-control);
            background:var(--surface);border:1px solid ${tool === t.key ? 'var(--accent)' : 'var(--border)'};
            color:${tool === t.key ? 'var(--accent)' : 'var(--text-primary)'};font-size:var(--text-xs);
            font-weight:var(--weight-medium);padding:0 2px;">${t.label}</button>`
        ).join('')}
        <button data-action="undo" aria-label="Undo" style="width:48px;height:48px;border-radius:var(--radius-control);
          background:var(--surface);border:1px solid var(--border);color:var(--text-secondary);font-size:18px;">↺</button>
      </div>
    </footer>
  </div>`);

  app!.append(shell); // before mounting overlays — they measure the frame's layout
  const frame = shell.querySelector<HTMLElement>('[data-role=frame]')!;
  mountPreview(frame, s, tool);

  shell.querySelector('[data-action=back]')?.addEventListener('click', () => {
    set({ screen: 'upload', session: null, tool: null, sheet: false });
  });
  shell.querySelector('[data-action=save]')?.addEventListener('click', () => set({ sheet: true }));
  shell.querySelector('[data-action=undo]')?.addEventListener('click', undo);
  shell.querySelectorAll<HTMLElement>('[data-bg]').forEach((b) =>
    b.addEventListener('click', () => set({ bg: b.dataset.bg as BgKey }))
  );
  shell.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) =>
    b.addEventListener('click', () => {
      const key = b.dataset.tool as Tool;
      if (state.tool === key) {
        set({ tool: null });
        return;
      }
      if (key === 'trim') {
        const remembered = Number(localStorage.getItem(TRIM_KEY));
        state.trimFrac = remembered > 0 && remembered < 1 ? remembered : 0.9;
      }
      set({ tool: key });
    })
  );

  if (state.sheet) renderSheet();
}

/** The preview: composited canvases plus per-tool overlays. Pointer work
 * mutates the DOM directly — no full re-render per move. */
function mountPreview(frame: HTMLElement, s: EditSession, tool: Tool | null): void {
  for (const [canvas, z] of [
    [s.subjectCanvas, '1'],
    [s.beforeCanvas, '2']
  ] as const) {
    canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:${z};pointer-events:none;`;
  }
  s.beforeCanvas.style.clipPath = 'inset(0 100% 0 0)';
  frame.append(s.subjectCanvas, s.beforeCanvas);

  if (tool === null) mountCompare(frame, s);
  else if (tool === 'trim') mountTrim(frame, s);
  else if (tool === 'tap') mountTap(frame, s);
  else if (tool === 'brush') mountBrush(frame, s);
  else mountLoupe(frame, s);
}

function mountCompare(frame: HTMLElement, s: EditSession): void {
  frame.append(
    html(`<div data-role="chip" style="position:absolute;top:12px;left:12px;z-index:4;padding:4px 10px;
      border-radius:999px;background:rgba(22,22,26,0.85);border:1px solid var(--border-strong);
      font-size:var(--text-xs);color:var(--text-secondary);visibility:hidden;">Original</div>`),
    html(`<div data-role="divider" style="position:absolute;top:0;bottom:0;z-index:3;width:2px;margin-left:-1px;
      background:var(--text-primary);box-shadow:0 0 6px rgba(0,0,0,0.6);"></div>`),
    html(`<div data-role="handle" style="position:absolute;top:50%;z-index:4;transform:translate(-50%,-50%);
      width:38px;height:38px;border-radius:50%;background:var(--text-primary);color:var(--canvas);
      display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:var(--weight-bold);
      cursor:ew-resize;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,0.5);">‹›</div>`)
  );
  const divider = frame.querySelector<HTMLElement>('[data-role=divider]')!;
  const handle = frame.querySelector<HTMLElement>('[data-role=handle]')!;
  const chip = frame.querySelector<HTMLElement>('[data-role=chip]')!;

  const apply = (compare: number): void => {
    const pct = (compare * 100).toFixed(2);
    s.beforeCanvas.style.clipPath = `inset(0 ${(100 - compare * 100).toFixed(2)}% 0 0)`;
    divider.style.left = `${pct}%`;
    handle.style.left = `clamp(24px, ${pct}%, calc(100% - 24px))`;
    chip.style.visibility = compare > 0.15 ? 'visible' : 'hidden';
  };

  if (state.reveal) {
    state.reveal = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) apply(0);
    else {
      const REVEAL_MS = 500;
      const start = performance.now();
      const step = (now: number): void => {
        const t = Math.min(1, (now - start) / REVEAL_MS);
        apply(1 - (1 - Math.pow(1 - t, 3)));
        if (t < 1) requestAnimationFrame(step);
      };
      apply(1);
      requestAnimationFrame(step);
    }
  } else apply(0);

  const drag = (e: PointerEvent): void => {
    const r = frame.getBoundingClientRect();
    apply(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  };
  frame.addEventListener('pointerdown', (e) => {
    frame.setPointerCapture(e.pointerId);
    drag(e);
  });
  frame.addEventListener('pointermove', (e) => {
    if (e.buttons === 1) drag(e);
  });
}

function toolStrip(hint: string, primary: string, extra = ''): HTMLElement {
  return html(`<div style="position:absolute;left:12px;right:12px;bottom:12px;z-index:5;display:flex;
    align-items:center;gap:var(--space-2);background:rgba(22,22,26,0.92);border:1px solid var(--border-strong);
    border-radius:var(--radius-card);padding:8px 8px 8px 12px;">
    <div style="flex:1;font-size:13px;color:var(--text-secondary);line-height:1.3;">${escapeHtml(hint)}</div>
    ${extra}
    <button data-action="tool-primary" style="height:36px;padding:0 14px;border-radius:var(--radius-control);
      background:var(--accent);border:none;color:var(--canvas);font-size:var(--text-sm);
      font-weight:var(--weight-medium);">${escapeHtml(primary)}</button>
  </div>`);
}

function mountTrim(frame: HTMLElement, s: EditSession): void {
  const shade = html(`<div style="position:absolute;left:0;z-index:3;background:rgba(14,14,17,0.55);"></div>`);
  const line = html(`<div style="position:absolute;z-index:3;height:2px;margin-top:-1px;background:var(--accent);"></div>`);
  const grip = html(`<div style="position:absolute;z-index:4;transform:translate(-50%,-50%);height:32px;
    padding:0 14px;border-radius:999px;background:var(--accent);color:var(--canvas);display:flex;
    align-items:center;font-size:var(--text-xs);font-weight:var(--weight-bold);cursor:ns-resize;
    user-select:none;">DRAG TO TRIM</div>`);
  frame.append(shade, line, grip);

  const apply = (): void => {
    const r = imageRect(frame, s);
    // trimFrac is in full-image space; the view shows the crop
    const viewFrac =
      (state.trimFrac * s.height - s.crop.y0) / Math.max(1, s.crop.y1 - s.crop.y0);
    const y = r.top + Math.max(0, Math.min(1, viewFrac)) * r.height;
    Object.assign(shade.style, {
      left: `${r.left}px`,
      width: `${r.width}px`,
      top: `${y}px`,
      height: `${Math.max(0, r.top + r.height - y)}px`
    });
    Object.assign(line.style, { left: `${r.left}px`, width: `${r.width}px`, top: `${y}px` });
    Object.assign(grip.style, { left: `${r.left + r.width / 2}px`, top: `${y}px` });
  };
  apply();

  const drag = (e: PointerEvent): void => {
    const { y } = toImageCoords(frame, s, e.clientX, e.clientY);
    state.trimFrac = Math.max(0.05, Math.min(0.99, y));
    apply();
  };
  grip.addEventListener('pointerdown', (e) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointermove', (e) => {
    if (e.buttons === 1) drag(e);
  });

  const strip = toolStrip('Drag the line — everything below it goes', 'Apply');
  frame.append(strip);
  strip.querySelector('[data-action=tool-primary]')?.addEventListener('click', () => {
    localStorage.setItem(TRIM_KEY, String(state.trimFrac));
    state.tool = null;
    commitOp({ kind: 'trim', y: state.trimFrac });
    toast('Trimmed below the line');
  });
}

function mountTap(frame: HTMLElement, s: EditSession): void {
  const catcher = html(
    `<div style="position:absolute;inset:0;z-index:4;cursor:crosshair;"></div>`
  );
  frame.append(catcher);
  catcher.addEventListener('click', (e) => {
    const { x, y } = toImageCoords(frame, s, e.clientX, e.clientY);
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    // Probe on a copy first so a miss doesn't burn an op on the undo stack.
    const probe = replayOps(s.baseAlpha, s.width, s.height, s.ops);
    const px = Math.min(s.width - 1, Math.round(x * s.width));
    const py = Math.min(s.height - 1, Math.round(y * s.height));
    if (probe[py * s.width + px]! <= 8) {
      toast('Nothing to remove there');
      return;
    }
    state.tool = null;
    commitOp({ kind: 'tap', x, y });
    toast('Region removed');
  });
  const strip = toolStrip('Tap a leftover object to remove it', 'Done');
  frame.append(strip);
  strip.querySelector('[data-action=tool-primary]')?.addEventListener('click', () =>
    set({ tool: null })
  );
}

function mountBrush(frame: HTMLElement, s: EditSession): void {
  const overlay = document.createElement('canvas');
  overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none;';
  const catcher = html(
    `<div style="position:absolute;inset:0;z-index:4;cursor:crosshair;touch-action:none;"></div>`
  );
  frame.append(overlay, catcher);

  let points: Array<[number, number]> = [];

  const sizeOverlay = (): void => {
    if (overlay.width !== frame.clientWidth) {
      overlay.width = frame.clientWidth;
      overlay.height = frame.clientHeight;
    }
  };

  const draw = (): void => {
    sizeOverlay();
    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (points.length === 0) return;
    const r = imageRect(frame, s);
    const cw = s.crop.x1 - s.crop.x0;
    const toView = ([nx, ny]: [number, number]): [number, number] => [
      r.left + ((nx * s.width - s.crop.x0) / cw) * r.width,
      r.top + ((ny * s.height - s.crop.y0) / Math.max(1, s.crop.y1 - s.crop.y0)) * r.height
    ];
    ctx.strokeStyle =
      state.brushMode === 'add' ? 'rgba(110,138,207,0.45)' : 'rgba(201,106,106,0.45)';
    ctx.lineWidth = ((state.brushRadius * 2 * s.width) / cw) * r.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((p, i) => {
      const [vx, vy] = toView(p);
      if (i === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    });
    if (points.length === 1) {
      const [vx, vy] = toView(points[0]!);
      ctx.lineTo(vx + 0.1, vy);
    }
    ctx.stroke();
  };

  catcher.addEventListener('pointerdown', (e) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { x, y } = toImageCoords(frame, s, e.clientX, e.clientY);
    points = [[x, y]];
    draw();
  });
  catcher.addEventListener('pointermove', (e) => {
    if (e.buttons !== 1 || points.length === 0) return;
    const { x, y } = toImageCoords(frame, s, e.clientX, e.clientY);
    points.push([x, y]);
    draw();
  });
  catcher.addEventListener('pointerup', () => {
    if (points.length === 0) return;
    const stroke = points;
    points = [];
    commitOp({ kind: 'brush', mode: state.brushMode, radius: state.brushRadius, points: stroke });
  });

  const sizes = [0.006, 0.012, 0.024];
  const extra = `<div style="display:flex;gap:4px;align-items:center;">
    <button data-brush-mode="add" style="height:32px;padding:0 10px;border-radius:var(--radius-control);
      background:${state.brushMode === 'add' ? '#2A2A31' : 'transparent'};border:1px solid var(--border-strong);
      color:${state.brushMode === 'add' ? 'var(--accent)' : 'var(--text-secondary)'};font-size:var(--text-xs);
      font-weight:var(--weight-medium);">Add</button>
    <button data-brush-mode="erase" style="height:32px;padding:0 10px;border-radius:var(--radius-control);
      background:${state.brushMode === 'erase' ? '#2A2A31' : 'transparent'};border:1px solid var(--border-strong);
      color:${state.brushMode === 'erase' ? 'var(--danger)' : 'var(--text-secondary)'};font-size:var(--text-xs);
      font-weight:var(--weight-medium);">Erase</button>
    ${sizes
      .map(
        (v, i) => `<button data-brush-size="${v}" aria-label="Brush size ${i + 1}" style="width:32px;height:32px;
          border-radius:var(--radius-control);background:none;border:1px solid
          ${Math.abs(state.brushRadius - v) < 1e-9 ? 'var(--accent)' : 'var(--border-strong)'};
          display:flex;align-items:center;justify-content:center;padding:0;">
          <span style="display:block;width:${6 + i * 4}px;height:${6 + i * 4}px;border-radius:50%;
            background:var(--text-secondary);"></span></button>`
      )
      .join('')}
  </div>`;
  const strip = toolStrip('Paint over the edge to add or erase', 'Done', extra);
  frame.append(strip);
  strip.querySelector('[data-action=tool-primary]')?.addEventListener('click', () =>
    set({ tool: null })
  );
  strip.querySelectorAll<HTMLElement>('[data-brush-mode]').forEach((b) =>
    b.addEventListener('click', () => set({ brushMode: b.dataset.brushMode as 'add' | 'erase' }))
  );
  strip.querySelectorAll<HTMLElement>('[data-brush-size]').forEach((b) =>
    b.addEventListener('click', () => set({ brushRadius: Number(b.dataset.brushSize) }))
  );
}

function mountLoupe(frame: HTMLElement, s: EditSession): void {
  const SIZE = 140;
  const ZOOM = 3;
  const loupe = html(`<div style="position:absolute;z-index:4;width:${SIZE}px;height:${SIZE}px;
    border-radius:50%;overflow:hidden;background:${BG[state.bg]};box-shadow:0 8px 24px rgba(0,0,0,0.5),
    inset 0 0 0 2px var(--border-strong);cursor:grab;touch-action:none;"></div>`);
  const zoomCanvas = document.createElement('canvas');
  zoomCanvas.width = SIZE;
  zoomCanvas.height = SIZE;
  loupe.append(zoomCanvas);
  frame.append(loupe);

  let fx = 0.55;
  let fy = 0.4; // loupe centre, fractions of the frame

  const drawZoom = (): void => {
    const r = imageRect(frame, s);
    const cw = s.crop.x1 - s.crop.x0;
    const ch = s.crop.y1 - s.crop.y0;
    // frame point → subject-canvas pixel
    const px = ((fx * frame.clientWidth - r.left) / r.width) * cw;
    const py = ((fy * frame.clientHeight - r.top) / r.height) * ch;
    const srcW = (SIZE / ZOOM) * (cw / r.width);
    const ctx = zoomCanvas.getContext('2d')!;
    ctx.fillStyle = BG[state.bg];
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      s.subjectCanvas,
      px - srcW / 2,
      py - srcW / 2,
      srcW,
      srcW,
      0,
      0,
      SIZE,
      SIZE
    );
    loupe.style.left = `${fx * frame.clientWidth - SIZE / 2}px`;
    loupe.style.top = `${fy * frame.clientHeight - SIZE / 2}px`;
  };
  drawZoom();

  loupe.addEventListener('pointerdown', (e) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  });
  loupe.addEventListener('pointermove', (e) => {
    if (e.buttons !== 1) return;
    const r = frame.getBoundingClientRect();
    fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    fy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    drawZoom();
  });

  const strip = toolStrip('Drag the loupe along an edge', 'Done');
  frame.append(strip);
  strip.querySelector('[data-action=tool-primary]')?.addEventListener('click', () =>
    set({ tool: null })
  );
}

function renderSheet(): void {
  const s = state.session!;
  const scale = Math.min(1, EXPORT_DIM / Math.max(s.cutoutBitmap.width, s.cutoutBitmap.height));
  const ew = Math.round((s.crop.x1 - s.crop.x0) * (s.cutoutBitmap.width * scale) / s.width);
  const eh = Math.round((s.crop.y1 - s.crop.y0) * (s.cutoutBitmap.height * scale) / s.height);
  const sheet = html(`<div style="position:fixed;inset:0;z-index:40;">
    <div data-action="close" style="position:absolute;inset:0;background:rgba(0,0,0,0.5);"></div>
    <div style="position:absolute;left:0;right:0;bottom:0;background:var(--surface-raised);
      border-radius:var(--radius-card) var(--radius-card) 0 0;border-top:1px solid var(--border-strong);
      padding:14px 16px 24px;display:flex;flex-direction:column;gap:var(--space-3);">
      <div style="display:flex;align-items:center;">
        <div style="flex:1;font-size:var(--text-md);font-weight:var(--weight-medium);">Download</div>
        <button data-action="close" aria-label="Close" style="width:36px;height:36px;background:none;
          border:none;color:var(--text-secondary);font-size:16px;">✕</button>
      </div>
      <div style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.45;">
        Exports on black. The background you were viewing is just for checking.</div>
      <div style="font-size:var(--text-sm);color:var(--text-tertiary);">PNG · ${ew} × ${eh}</div>
      <button data-action="download" ${state.busy ? 'disabled' : ''} style="height:50px;
        border-radius:var(--radius-control);background:var(--accent);border:none;color:var(--canvas);
        font-size:var(--text-md);font-weight:var(--weight-medium);opacity:${state.busy ? 0.6 : 1};">
        ${state.busy ? 'Preparing…' : 'Download PNG'}</button>
    </div>
  </div>`);
  sheet.querySelectorAll('[data-action=close]').forEach((el) =>
    el.addEventListener('click', () => set({ sheet: false }))
  );
  sheet.querySelector('[data-action=download]')?.addEventListener('click', () => {
    void downloadResult();
  });
  app!.append(sheet);
}

/* ---------- utilities ---------- */

function html(markup: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as HTMLElement;
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

render();
