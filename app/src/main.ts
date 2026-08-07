import './styles/base.css';
import { fetchCutout, fetchOriginal, segmentImage, uploadImage } from './lib/api';
import { alphaBBox, padBBox } from './lib/cutout';
import { correctLighting } from './lib/lighting';

/* M2: upload → cutout → lighting correction → before/after → download.
 * The correction editor (trim / tap / brush / loupe) arrives in M3.
 * Screens follow design/EditorPhone.dc.html. */

const MAX_DIM = 2048; // working + export resolution cap

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing #app root');

type Screen = 'upload' | 'processing' | 'result' | 'error';

interface Result {
  /** Original photo, cropped to the subject — the "before". */
  before: HTMLCanvasElement;
  /** Corrected cutout on true black — the "after", and the export. */
  after: HTMLCanvasElement;
}

interface State {
  screen: Screen;
  fileName: string;
  message: string;
  result: Result | null;
}

const state: State = { screen: 'upload', fileName: '', message: '', result: null };

function set(patch: Partial<State>): void {
  Object.assign(state, patch);
  render();
}

async function processFile(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) {
    set({ screen: 'error', message: 'That file is not an image.' });
    return;
  }
  set({ screen: 'processing', fileName: file.name, message: 'Removing background…' });
  try {
    const id = await uploadImage(file);
    await segmentImage(id);
    set({ message: 'Correcting lighting…' });
    const [cutout, original] = await Promise.all([fetchCutout(id), fetchOriginal(id)]);
    set({ screen: 'result', result: await compose(original, cutout) });
  } catch (err) {
    set({
      screen: 'error',
      message: err instanceof Error ? err.message : 'Something went wrong. Please try again.'
    });
  }
}

function drawScaled(bitmap: ImageBitmap, width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx;
}

/** Correct lighting on the cutout (original supplies the background for white
 * balance), auto-crop to the subject, and build before/after canvases. */
async function compose(originalBlob: Blob, cutoutBlob: Blob): Promise<Result> {
  const cutoutBmp = await createImageBitmap(cutoutBlob);
  const scale = Math.min(1, MAX_DIM / Math.max(cutoutBmp.width, cutoutBmp.height));
  const w = Math.round(cutoutBmp.width * scale);
  const h = Math.round(cutoutBmp.height * scale);

  const cutCtx = drawScaled(cutoutBmp, w, h);
  const origCtx = drawScaled(await createImageBitmap(originalBlob), w, h);

  const cutData = cutCtx.getImageData(0, 0, w, h);
  const origData = origCtx.getImageData(0, 0, w, h);

  const { rgba: corrected } = correctLighting(cutData.data, origData.data, w, h);
  const box = alphaBBox(corrected, w, h);
  const crop = box ? padBBox(box, w, h) : { x0: 0, y0: 0, x1: w, y1: h };
  const cw = crop.x1 - crop.x0;
  const ch = crop.y1 - crop.y0;

  const correctedCanvas = document.createElement('canvas');
  correctedCanvas.width = w;
  correctedCanvas.height = h;
  correctedCanvas
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(corrected), w, h), 0, 0);

  const after = document.createElement('canvas');
  after.width = cw;
  after.height = ch;
  const actx = after.getContext('2d')!;
  actx.fillStyle = '#000000'; // export background is always true black
  actx.fillRect(0, 0, cw, ch);
  actx.drawImage(correctedCanvas, crop.x0, crop.y0, cw, ch, 0, 0, cw, ch);

  const before = document.createElement('canvas');
  before.width = cw;
  before.height = ch;
  before.getContext('2d')!.drawImage(origCtx.canvas, crop.x0, crop.y0, cw, ch, 0, 0, cw, ch);

  return { before, after };
}

function download(): void {
  if (!state.result) return;
  state.result.after.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'studioshot.png';
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
}

function render(): void {
  if (!app) return;
  app.replaceChildren();

  if (state.screen === 'upload' || state.screen === 'error') {
    app.append(
      el(`<div style="min-height:100dvh;display:flex;flex-direction:column;">
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
    app.querySelector('[data-action=choose]')?.addEventListener('click', () => input.click());
    return;
  }

  if (state.screen === 'processing') {
    app.append(
      el(`<div style="min-height:100dvh;display:flex;align-items:flex-end;padding:var(--space-3);">
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
    return;
  }

  // result — before/after with the reveal, the one place the motion budget is spent
  const shell = el(`<div style="min-height:100dvh;display:flex;flex-direction:column;">
    <header style="display:flex;align-items:center;height:52px;padding:0 var(--space-2);">
      <button data-action="reset" aria-label="Start over" style="width:44px;height:44px;background:none;
        border:none;color:var(--text-secondary);font-size:var(--text-xl);line-height:1;">‹</button>
      <div style="flex:1;text-align:center;font-size:var(--text-sm);color:var(--text-tertiary);">
        ${escapeHtml(state.fileName)}</div>
      <div style="width:44px;"></div>
    </header>
    <main style="flex:1;display:flex;padding:0 var(--space-3);">
      <div data-role="frame" style="position:relative;flex:1;border-radius:var(--radius-frame);
        border:1px solid var(--border);overflow:hidden;background:var(--preview-black);touch-action:none;">
        <div data-role="chip" style="position:absolute;top:12px;left:12px;z-index:3;padding:4px 10px;
          border-radius:999px;background:rgba(22,22,26,0.85);border:1px solid var(--border-strong);
          font-size:var(--text-xs);color:var(--text-secondary);visibility:hidden;">Original</div>
        <div data-role="divider" style="position:absolute;top:0;bottom:0;z-index:2;width:2px;margin-left:-1px;
          background:var(--text-primary);box-shadow:0 0 6px rgba(0,0,0,0.6);"></div>
        <div data-role="handle" style="position:absolute;top:50%;z-index:3;transform:translate(-50%,-50%);
          width:38px;height:38px;border-radius:50%;background:var(--text-primary);color:var(--canvas);
          display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:var(--weight-bold);
          cursor:ew-resize;box-shadow:0 2px 8px rgba(0,0,0,0.5);user-select:none;">‹›</div>
      </div>
    </main>
    <footer style="display:flex;gap:var(--space-2);padding:var(--space-3) var(--space-4) var(--space-4);">
      <button data-action="reset" style="flex:1;height:50px;border-radius:var(--radius-control);
        background:var(--surface);border:1px solid var(--border);color:var(--text-primary);
        font-size:var(--text-md);font-weight:var(--weight-medium);">Start over</button>
      <button data-action="download" style="flex:1;height:50px;border-radius:var(--radius-control);
        background:var(--accent);border:none;color:var(--canvas);
        font-size:var(--text-md);font-weight:var(--weight-medium);">Download</button>
    </footer>
  </div>`);

  const frame = shell.querySelector<HTMLElement>('[data-role=frame]')!;
  if (state.result) {
    for (const [canvas, z] of [
      [state.result.after, '0'],
      [state.result.before, '1']
    ] as const) {
      canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:${z};`;
    }
    frame.prepend(state.result.after, state.result.before);
    attachCompare(frame, state.result.before);
  }
  shell
    .querySelectorAll('[data-action=reset]')
    .forEach((b) =>
      b.addEventListener('click', () => set({ screen: 'upload', result: null, message: '' }))
    );
  shell.querySelector('[data-action=download]')?.addEventListener('click', download);
  app.append(shell);
}

/** Before/after compare: divider drag plus the one-time reveal (DESIGN.md §4:
 * 400–600ms, the single motion indulgence, honouring prefers-reduced-motion). */
function attachCompare(frame: HTMLElement, before: HTMLCanvasElement): void {
  const divider = frame.querySelector<HTMLElement>('[data-role=divider]')!;
  const handle = frame.querySelector<HTMLElement>('[data-role=handle]')!;
  const chip = frame.querySelector<HTMLElement>('[data-role=chip]')!;

  const apply = (compare: number): void => {
    const pct = (compare * 100).toFixed(2);
    before.style.clipPath = `inset(0 ${(100 - compare * 100).toFixed(2)}% 0 0)`;
    divider.style.left = `${pct}%`;
    handle.style.left = `clamp(24px, ${pct}%, calc(100% - 24px))`;
    chip.style.visibility = compare > 0.15 ? 'visible' : 'hidden';
  };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    apply(0);
  } else {
    const REVEAL_MS = 500;
    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / REVEAL_MS);
      apply(1 - (1 - Math.pow(1 - t, 3))); // cubic ease-out from 1 → 0
      if (t < 1) requestAnimationFrame(step);
    };
    apply(1);
    requestAnimationFrame(step);
  }

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

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

render();
