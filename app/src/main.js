// Wires the studio: layout and grade pickers, per-panel photo assignment with
// drag-to-pan and zoom, editable lettering, and one-click PNG exports at the
// three common post sizes. A `?shot=` query sets up a fixed scene for a
// screenshot instead (./shots.js). Photos are read on this machine and never
// uploaded; the app fetches nothing from the network.

import { LAYOUTS, GRADES, EXPORT_SIZES, createState, applyLayout, applyPhotoToAll, panelAt } from './scene.js';
import { renderCover } from './render.js';
import { runShot } from './shots.js';

const canvas = document.getElementById('cover');
const status = document.getElementById('status');
const state = createState();

/** Loaded images by photo key: 'boulevard', 'pier', 'upload'. */
const images = {};

/** Loads an image from a URL, resolving once it can be drawn. */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Loads a bundled sample photo once, then keeps it cached. */
async function loadSample(key) {
  if (!images[key]) images[key] = await loadImage(`samples/${key}.jpg`);
  return images[key];
}

/** Redraws the preview canvas from the current state. */
function render() {
  renderCover(canvas, state, images);
}

/** Sizes the preview canvas to its box and redraws. In shot-cover mode the
 * canvas fills the whole viewport, so a wide screenshot stays wide. */
function fitPreview() {
  if (document.body.classList.contains('shot-cover')) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    render();
    return;
  }
  const box = canvas.parentElement.getBoundingClientRect();
  const size = Math.max(320, Math.floor(Math.min(box.width, box.height)));
  if (canvas.width !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  render();
}

/** Renders the state offscreen at w x h and downloads it as a PNG. */
function exportPng(size) {
  const off = document.createElement('canvas');
  off.width = size.w;
  off.height = size.h;
  renderCover(off, state, images);
  off.toBlob((blob) => {
    if (!blob) {
      status.textContent = 'Export failed — try again.';
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `neon-sunset-cover-${size.w}x${size.h}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    status.textContent = `Saved ${a.download} (${(blob.size / 1024).toFixed(0)} KiB)`;
  }, 'image/png');
}

/** Builds one row of toggle buttons from a map of { id: { name, blurb } }. */
function buildToggles(containerId, entries, current, onPick) {
  const box = document.getElementById(containerId);
  box.textContent = '';
  for (const [id, entry] of Object.entries(entries)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toggle' + (id === current ? ' active' : '');
    b.textContent = entry.name;
    b.title = entry.blurb ?? entry.name;
    b.addEventListener('click', () => {
      onPick(id);
      for (const child of box.children) child.classList.toggle('active', child === b);
      render();
    });
    box.appendChild(b);
  }
}

/** Refreshes the "panel N of M" label and the zoom slider for the selection. */
function refreshPanelUI() {
  const n = state.panels.length;
  document.getElementById('panelLabel').textContent =
    `Panel ${state.selectedPanel + 1} of ${n} — click the cover to pick another`;
  document.getElementById('zoom').value = String(state.panels[state.selectedPanel].zoom);
  document.getElementById('zoomVal').textContent =
    `${state.panels[state.selectedPanel].zoom.toFixed(2)}x`;
}

buildToggles('layoutRow', LAYOUTS, state.layout, (id) => {
  applyLayout(state, id);
  refreshPanelUI();
});
buildToggles('gradeRow', GRADES, state.grade, (id) => {
  state.grade = id;
});

const intensity = document.getElementById('intensity');
intensity.addEventListener('input', () => {
  state.gradeIntensity = Number(intensity.value);
  document.getElementById('intensityVal').textContent = `${Math.round(state.gradeIntensity * 100)}%`;
  render();
});

const zoom = document.getElementById('zoom');
zoom.addEventListener('input', () => {
  state.panels[state.selectedPanel].zoom = Number(zoom.value);
  document.getElementById('zoomVal').textContent = `${state.panels[state.selectedPanel].zoom.toFixed(2)}x`;
  render();
});

document.getElementById('photoFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  images.upload = await loadImage(URL.createObjectURL(file));
  state.panels[state.selectedPanel].photo = 'upload';
  document.getElementById('photoName').textContent = file.name;
  render();
});

for (const key of ['boulevard', 'pier']) {
  document.getElementById(`sample-${key}`).addEventListener('click', async () => {
    await loadSample(key);
    state.panels[state.selectedPanel].photo = key;
    document.getElementById('photoName').textContent = `Sample: ${key}.jpg`;
    render();
  });
}
document.getElementById('photoAll').addEventListener('click', () => {
  applyPhotoToAll(state, state.panels[state.selectedPanel].photo);
  render();
  status.textContent = 'One photo across all panels.';
});

const captionInput = document.getElementById('caption');
const subtitleInput = document.getElementById('subtitle');
captionInput.addEventListener('input', () => {
  state.caption = captionInput.value;
  render();
});
subtitleInput.addEventListener('input', () => {
  state.subtitle = subtitleInput.value;
  render();
});
document.getElementById('captionSize').addEventListener('input', (e) => {
  state.captionSize = Number(e.target.value);
  document.getElementById('captionSizeVal').textContent = `${Math.round(state.captionSize * 100)}%`;
  render();
});
document.getElementById('captionColor').addEventListener('input', (e) => {
  state.captionColor = e.target.value;
  render();
});
document.getElementById('outlineToggle').addEventListener('change', (e) => {
  state.outline = e.target.checked;
  render();
});
document.getElementById('neonToggle').addEventListener('change', (e) => {
  state.neon = e.target.checked;
  render();
});

const exportRow = document.getElementById('exportRow');
for (const size of EXPORT_SIZES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'export';
  b.textContent = `PNG ${size.label}`;
  b.addEventListener('click', () => exportPng(size));
  exportRow.appendChild(b);
}

// Click a panel to select it; drag it to pan the photo inside its frame.
let drag = null;
function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
}
canvas.addEventListener('pointerdown', (e) => {
  const p = canvasPoint(e);
  const hit = panelAt(state, p.x, p.y);
  if (hit < 0) return;
  state.selectedPanel = hit;
  refreshPanelUI();
  const slot = state.panels[hit];
  drag = { x: p.x, y: p.y, panX: slot.panX, panY: slot.panY };
  canvas.setPointerCapture(e.pointerId);
  render();
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = canvasPoint(e);
  const slot = state.panels[state.selectedPanel];
  slot.panX = drag.panX + (p.x - drag.x);
  slot.panY = drag.panY + (p.y - drag.y);
  render();
});
canvas.addEventListener('pointerup', () => {
  drag = null;
});
canvas.addEventListener('pointercancel', () => {
  drag = null;
});

window.addEventListener('resize', fitPreview);

// Test hook for the build's own browser checks: render any size offscreen.
window.__neonSunset = { state, images, renderCover, EXPORT_SIZES };

const query = new URLSearchParams(location.search);
const shot = query.get('shot');
if (shot) {
  fitPreview();
  runShot(shot, query, {
    state,
    render,
    fitPreview,
    loadSample,
  });
} else {
  Promise.all([loadSample('pier'), loadSample('boulevard')]).then(() => {
    // Default cover: pier in the hero slots, boulevard in the rest.
    state.panels.forEach((slot, i) => {
      slot.photo = i % 2 === 0 ? 'pier' : 'boulevard';
    });
    fitPreview();
  });
  fitPreview();
}
