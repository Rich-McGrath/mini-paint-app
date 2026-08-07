import './styles/base.css';
import { fetchCutout, segmentImage, uploadImage } from './lib/api';
import { alphaBBox, padBBox } from './lib/cutout';

/* M1 walking skeleton: upload → cutout on black → download.
 * The correction editor (trim / tap / brush / loupe) arrives in M3;
 * lighting correction in M2. Screens follow design/EditorPhone.dc.html. */

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing #app root');

type Screen = 'upload' | 'processing' | 'result' | 'error';

interface State {
  screen: Screen;
  fileName: string;
  message: string;
  /** Cutout auto-cropped and composited on true black — the export. */
  result: HTMLCanvasElement | null;
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
    set({ message: 'Preparing your photo…' });
    const cutout = await fetchCutout(id);
    set({ screen: 'result', result: await compose(cutout) });
  } catch (err) {
    set({
      screen: 'error',
      message: err instanceof Error ? err.message : 'Something went wrong. Please try again.'
    });
  }
}

/** Auto-crop to the subject's alpha bounding box and composite on true black. */
async function compose(cutout: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(cutout);
  const work = document.createElement('canvas');
  work.width = bitmap.width;
  work.height = bitmap.height;
  const wctx = work.getContext('2d');
  if (!wctx) throw new Error('canvas unavailable');
  wctx.drawImage(bitmap, 0, 0);

  const { data } = wctx.getImageData(0, 0, work.width, work.height);
  const box = alphaBBox(data, work.width, work.height);
  const crop = box
    ? padBBox(box, work.width, work.height)
    : { x0: 0, y0: 0, x1: work.width, y1: work.height };

  const out = document.createElement('canvas');
  out.width = crop.x1 - crop.x0;
  out.height = crop.y1 - crop.y0;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('canvas unavailable');
  octx.fillStyle = '#000000'; // export background is always true black
  octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(work, crop.x0, crop.y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function download(): void {
  if (!state.result) return;
  state.result.toBlob((blob) => {
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

  // result
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
        border:1px solid var(--border);overflow:hidden;background:var(--preview-black);
        display:flex;align-items:center;justify-content:center;"></div>
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
  if (state.result) {
    state.result.style.maxWidth = '100%';
    state.result.style.maxHeight = '100%';
    state.result.style.objectFit = 'contain';
    shell.querySelector('[data-role=frame]')?.append(state.result);
  }
  shell.querySelectorAll('[data-action=reset]').forEach((b) =>
    b.addEventListener('click', () => set({ screen: 'upload', result: null, message: '' }))
  );
  shell.querySelector('[data-action=download]')?.addEventListener('click', download);
  app.append(shell);
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
