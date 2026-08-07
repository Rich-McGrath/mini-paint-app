import './styles/base.css';

/* M0 scaffold: the upload screen shell from design/EditorPhone.dc.html.
 * M1 wires the file input to upload → segmentation → cutout. */

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing #app root');

app.innerHTML = `
  <div style="min-height:100dvh;display:flex;flex-direction:column;">
    <header style="padding:var(--space-4) var(--space-4) 0;text-align:center;
      font-size:var(--text-sm);font-weight:var(--weight-bold);letter-spacing:0.12em;
      color:var(--text-secondary);">STUDIOSHOT</header>
    <main style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
      gap:var(--space-3);padding:0 var(--space-8);text-align:center;">
      <h1 style="margin:0;font-size:var(--text-xl);font-weight:var(--weight-bold);line-height:1.2;">
        Shot at your desk.</h1>
      <p style="margin:0;font-size:var(--text-md);color:var(--text-secondary);">
        Background removed, lighting fixed. Ready to post.</p>
      <label style="margin-top:var(--space-4);">
        <input type="file" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;" />
        <span role="button" tabindex="0" style="display:inline-flex;align-items:center;height:50px;
          padding:0 var(--space-8);border-radius:var(--radius-control);background:var(--accent);
          color:var(--canvas);font-size:var(--text-md);font-weight:var(--weight-medium);
          cursor:pointer;">Choose photo</span>
      </label>
      <p style="margin:0;font-size:var(--text-xs);color:var(--text-tertiary);">
        Your original is never modified</p>
    </main>
  </div>
`;
