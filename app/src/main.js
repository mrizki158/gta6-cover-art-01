// Wires the studio around one central store: a single cover object, one
// paint() that redraws the preview from it, and one sync() that refreshes
// every control from it. Every change goes through commit() — mutate the
// cover, then paint and sync — so the preview and the controls can never
// drift apart. All clicks and inputs arrive through two delegated
// handlers on the document (one for clicks, one for inputs), keyed off
// data attributes on the buttons, so adding a control is one line of
// markup plus one case in the handler, never a new listener.
//
// New in this round: a duotone toggle (the renderer's two-tone stage)
// and photo position presets (center / top / face) that pan the selected
// frame's photo to a sensible starting spot. A `?shot=` query sets up a
// fixed scene for a screenshot instead (./shots.js). Photos are read on
// this machine and never uploaded; the app fetches nothing from the
// network.

import {
  LAYOUTS, LAYOUT_IDS, GRADES, EXPORT_SIZES, PHOTO_POSITIONS,
  freshCover, switchLayout, fillAllFrames, applyPhotoPosition, frameUnderPoint,
} from './scene.js';
import { renderCover } from './render.js';
import { runShot } from './shots.js';

const preview = document.getElementById('cover');
const notice = document.getElementById('status');

/** The store: the cover being edited, and the photos loaded so far. */
const store = {
  cover: freshCover(),
  /** Loaded images by photo key: 'boulevard', 'pier', 'upload'. */
  photos: {},
};

const cover = store.cover;

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
  if (!store.photos[key]) store.photos[key] = await loadImage(`samples/${key}.jpg`);
  return store.photos[key];
}

/** Redraws the preview canvas from the store's cover. */
function paint() {
  renderCover(preview, cover, store.photos);
}

/**
 * The one way to change the cover: run the mutation, then repaint the
 * preview and refresh the controls. Every handler below goes through
 * here, so a change can never update the state without updating the
 * screen to match.
 */
function commit(mutator) {
  mutator(cover);
  paint();
  syncControls();
}

/** Sizes the preview canvas to its box and repaints. In shot-cover mode
 * the canvas fills the whole viewport, so a wide screenshot stays wide. */
function fitPreview() {
  if (document.body.classList.contains('shot-cover')) {
    preview.width = window.innerWidth;
    preview.height = window.innerHeight;
    paint();
    return;
  }
  const box = preview.parentElement.getBoundingClientRect();
  const size = Math.max(320, Math.floor(Math.min(box.width, box.height)));
  if (preview.width !== size) {
    preview.width = size;
    preview.height = size;
  }
  paint();
}

/** Renders the cover offscreen at w x h and downloads it as a PNG. */
function exportPng(size) {
  const off = document.createElement('canvas');
  off.width = size.w;
  off.height = size.h;
  renderCover(off, cover, store.photos);
  off.toBlob((blob) => {
    if (!blob) {
      notice.textContent = 'Export failed — try again.';
      return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `neon-sunset-cover-${size.w}x${size.h}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    notice.textContent = `Saved ${link.download} (${(blob.size / 1024).toFixed(0)} KiB)`;
  }, 'image/png');
}

/**
 * Builds a row of toggle buttons from a map of { id: { name, tagline } }
 * into the element with `containerId`, marking `current` active. Clicks
 * are handled by the delegated click handler (data-pick-* attributes),
 * so this only builds markup — no listeners live on the buttons.
 */
function buildPicker(containerId, entries, current, pickAttr) {
  const box = document.getElementById(containerId);
  box.textContent = '';
  for (const [id, entry] of Object.entries(entries)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip' + (id === current ? ' active' : '');
    button.textContent = entry.name;
    button.title = entry.tagline ?? entry.name;
    button.dataset[pickAttr] = id;
    box.appendChild(button);
  }
}

/** Marks the active button in a picker row after a change. */
function markActive(containerId, pickAttr, current) {
  for (const child of document.getElementById(containerId).children) {
    child.classList.toggle('active', child.dataset[pickAttr] === current);
  }
}

/** Refreshes every control from the store: pickers, sliders, toggles,
 * the frame label and the layout tagline. Called after every commit and
 * once at startup, so the controls always describe the cover on screen.
 */
function syncControls() {
  markActive('layoutPicker', 'pickLayout', cover.layout);
  markActive('gradePicker', 'pickGrade', cover.grade);
  markActive('positionPicker', 'pickPosition', cover.photoPosition);
  const layout = LAYOUTS[cover.layout];
  const tagline = document.getElementById('layoutTagline');
  if (tagline) tagline.textContent = layout.tagline;
  const frameCount = cover.frames.length;
  document.getElementById('frameLabel').textContent =
    `Frame ${cover.selectedFrame + 1} of ${frameCount} — click the cover to pick another`;
  const frame = cover.frames[cover.selectedFrame];
  document.getElementById('photoZoom').value = String(frame.zoom);
  document.getElementById('zoomValue').textContent = `${frame.zoom.toFixed(2)}x`;
  document.getElementById('gradeStrength').value = String(cover.gradeIntensity);
  document.getElementById('strengthValue').textContent = `${Math.round(cover.gradeIntensity * 100)}%`;
  document.getElementById('captionScale').value = String(cover.captionSize);
  document.getElementById('captionScaleValue').textContent = `${Math.round(cover.captionSize * 100)}%`;
  document.getElementById('outlineScale').value = String(cover.outlineWidth);
  document.getElementById('outlineScaleValue').textContent = `${Math.round(cover.outlineWidth * 100)}%`;
  document.getElementById('duotoneSwitch').checked = cover.duotone;
  document.getElementById('outlineSwitch').checked = cover.outline;
  document.getElementById('neonSwitch').checked = cover.neon;
}

/**
 * The single click handler for the whole studio. Buttons declare what
 * they do in data attributes; this switch is the only place clicks turn
 * into cover changes, which keeps the wiring in one readable list.
 */
document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-pick-layout], [data-pick-grade], [data-pick-position], [data-sample], [data-action], [data-export]');
  if (!target) return;

  if (target.dataset.pickLayout) {
    commit((c) => switchLayout(c, target.dataset.pickLayout));
    return;
  }
  if (target.dataset.pickGrade) {
    commit((c) => { c.grade = target.dataset.pickGrade; });
    return;
  }
  if (target.dataset.pickPosition) {
    commit((c) => applyPhotoPosition(c, target.dataset.pickPosition));
    return;
  }
  if (target.dataset.sample) {
    const key = target.dataset.sample;
    await loadSample(key);
    commit((c) => { c.frames[c.selectedFrame].photo = key; });
    document.getElementById('photoName').textContent = `Sample: ${key}.jpg`;
    return;
  }
  if (target.dataset.export) {
    const size = EXPORT_SIZES.find((s) => s.id === target.dataset.export);
    if (size) exportPng(size);
    return;
  }
  if (target.dataset.action === 'photo-all') {
    commit((c) => fillAllFrames(c, c.frames[c.selectedFrame].photo));
    notice.textContent = 'One photo across all frames.';
  }
});

/**
 * The single input handler for the whole studio: sliders, text fields
 * and checkboxes all report through here, keyed off their element id.
 * Each case is one small cover change, committed the same way.
 */
document.addEventListener('input', (event) => {
  const el = event.target;
  switch (el.id) {
    case 'gradeStrength':
      commit((c) => { c.gradeIntensity = Number(el.value); });
      break;
    case 'photoZoom':
      commit((c) => { c.frames[c.selectedFrame].zoom = Number(el.value); });
      break;
    case 'captionText':
      commit((c) => { c.caption = el.value; });
      break;
    case 'subtitleText':
      commit((c) => { c.subtitle = el.value; });
      break;
    case 'captionScale':
      commit((c) => { c.captionSize = Number(el.value); });
      break;
    case 'captionColour':
      commit((c) => { c.captionColor = el.value; });
      break;
    case 'outlineScale':
      commit((c) => { c.outlineWidth = Number(el.value); });
      break;
    case 'outlineSwitch':
      commit((c) => { c.outline = el.checked; });
      break;
    case 'neonSwitch':
      commit((c) => { c.neon = el.checked; });
      break;
    case 'duotoneSwitch':
      commit((c) => { c.duotone = el.checked; });
      break;
    default:
      break;
  }
});

/** The file input lives outside the delegated handlers: it reads a file. */
document.getElementById('photoFile').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  store.photos.upload = await loadImage(URL.createObjectURL(file));
  commit((c) => { c.frames[c.selectedFrame].photo = 'upload'; });
  document.getElementById('photoName').textContent = file.name;
});

// Build the pickers once, from the registries — eight layouts now, the
// new Vice Grid first, and the position presets beside the zoom control.
buildPicker('layoutPicker', LAYOUTS, cover.layout, 'pickLayout');
buildPicker('gradePicker', GRADES, cover.grade, 'pickGrade');
buildPicker('positionPicker', PHOTO_POSITIONS, cover.photoPosition, 'pickPosition');

const exportRow = document.getElementById('exportPicker');
for (const size of EXPORT_SIZES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'export';
  button.textContent = `PNG ${size.label}`;
  button.dataset.export = size.id;
  exportRow.appendChild(button);
}
syncControls();

// Click a frame to select it; drag it to pan the photo inside its frame.
// On Sunset Strip the thin side strip is its own frame, so clicking the
// right edge selects the strip photo instead of the hero. Dragging clears
// the position preset marker, since the pan is custom from then on.
let drag = null;
function canvasPoint(event) {
  const rect = preview.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
}
preview.addEventListener('pointerdown', (event) => {
  const point = canvasPoint(event);
  const hit = frameUnderPoint(cover, point.x, point.y);
  if (hit < 0) return;
  commit((c) => { c.selectedFrame = hit; });
  const frame = cover.frames[hit];
  drag = { x: point.x, y: point.y, panX: frame.panX, panY: frame.panY };
  preview.setPointerCapture(event.pointerId);
});
preview.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const point = canvasPoint(event);
  const frame = cover.frames[cover.selectedFrame];
  frame.panX = drag.panX + (point.x - drag.x);
  frame.panY = drag.panY + (point.y - drag.y);
  cover.photoPosition = 'custom';
  paint();
  syncControls();
});
preview.addEventListener('pointerup', () => {
  drag = null;
});
preview.addEventListener('pointercancel', () => {
  drag = null;
});

window.addEventListener('resize', fitPreview);

// Test hook for the build's own browser checks: render any size offscreen.
window.__coverStudio = { cover, photos: store.photos, renderCover, EXPORT_SIZES, LAYOUT_IDS };

const query = new URLSearchParams(location.search);
const shot = query.get('shot');
if (shot) {
  fitPreview();
  runShot(shot, query, {
    cover,
    paint,
    fitPreview,
    loadSample,
  });
} else {
  Promise.all([loadSample('pier'), loadSample('boulevard')]).then(() => {
    // Default cover: pier in the even frames, boulevard in the odd ones.
    cover.frames.forEach((frame, i) => {
      frame.photo = i % 2 === 0 ? 'pier' : 'boulevard';
    });
    fitPreview();
  });
  fitPreview();
}
