// The canvas renderer: draws a scene-graph state onto any 2D canvas at any
// size, so the on-screen preview and the exported PNGs are the same drawing.
// Passes, in order: photos clipped to their panel polygons, the retro sun,
// the colour grade, deterministic film grain, a vignette, then the lettering.
//
// Photos are drawn cover-fit per panel with the panel's own zoom and pan, so
// one photo can fill every panel or each panel can hold a different one.
// The grade is a stack of composite passes whose strength follows the
// intensity slider; the grain comes from a fixed seed, so two renders of the
// same state are pixel-identical.

import { LAYOUTS, GRADES } from './scene.js';

const FONT_FAMILY = '"Anton", "Arial Narrow", sans-serif';

/** A tiny deterministic PRNG (mulberry32) so the grain never flickers. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One 128 x 128 grain tile, built once and stamped across the canvas. */
let grainTile = null;
function getGrainTile() {
  if (grainTile) return grainTile;
  const tile = document.createElement('canvas');
  tile.width = 128;
  tile.height = 128;
  const tctx = tile.getContext('2d');
  const img = tctx.createImageData(128, 128);
  const rand = mulberry32(0x9e3779b9);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rand() * 255);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 28;
  }
  tctx.putImageData(img, 0, 0);
  grainTile = tile;
  return tile;
}

/** Shrinks a polygon a little toward its centroid, opening a dark gutter. */
function insetPoints(points, amount) {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= points.length;
  cy /= points.length;
  return points.map(([x, y]) => [cx + (x - cx) * (1 - amount), cy + (y - cy) * (1 - amount)]);
}

/** Traces a unit-coordinate polygon onto the canvas, scaled to w x h. */
function tracePolygon(ctx, points, w, h) {
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x * w, y * h);
    else ctx.lineTo(x * w, y * h);
  });
  ctx.closePath();
}

/** Draws one photo cover-fit inside a clipped polygon, with zoom and pan. */
function drawPanelPhoto(ctx, img, points, slot, w, h) {
  if (!img) return;
  ctx.save();
  tracePolygon(ctx, insetPoints(points, 0.006), w, h);
  ctx.clip();
  // The polygon's bounding box is the frame the photo must cover.
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const bw = (maxX - minX) * w;
  const bh = (maxY - minY) * h;
  const base = Math.max(bw / img.naturalWidth, bh / img.naturalHeight) * slot.zoom;
  const pw = img.naturalWidth * base;
  const ph = img.naturalHeight * base;
  const cx = minX * w + bw / 2 + slot.panX * bw;
  const cy = minY * h + bh / 2 + slot.panY * bh;
  ctx.drawImage(img, cx - pw / 2, cy - ph / 2, pw, ph);
  ctx.restore();
}

/** The striped retro sun: a warm disc with horizontal slits, upper right.
 * The disc and its slits are drawn on an offscreen canvas first, so cutting
 * the slits erases only the sun — the photo beneath shows through them. */
function drawRetroSun(ctx, w, h, grade) {
  const r = Math.min(w, h) * 0.13;
  const cx = w * 0.74;
  const cy = h * 0.17;
  ctx.save();
  const glow = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 2.2);
  glow.addColorStop(0, grade === 'golden-hour' ? 'rgba(255, 190, 80, 0.5)' : 'rgba(255, 90, 140, 0.45)');
  glow.addColorStop(1, 'rgba(255, 90, 140, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(cx - r * 2.2, cy - r * 2.2, r * 4.4, r * 4.4);
  ctx.restore();

  // Disc + slits on their own canvas, then stamped over the photo.
  const pad = Math.ceil(r * 1.1);
  const sun = document.createElement('canvas');
  sun.width = pad * 2;
  sun.height = pad * 2;
  const sctx = sun.getContext('2d');
  const disc = sctx.createLinearGradient(0, pad - r, 0, pad + r);
  if (grade === 'golden-hour') {
    disc.addColorStop(0, '#ffe9a8');
    disc.addColorStop(0.55, '#ffb347');
    disc.addColorStop(1, '#ff7a3d');
  } else {
    disc.addColorStop(0, '#ffd166');
    disc.addColorStop(0.55, '#ff6b6b');
    disc.addColorStop(1, '#ff2e88');
  }
  sctx.fillStyle = disc;
  sctx.beginPath();
  sctx.arc(pad, pad, r, 0, Math.PI * 2);
  sctx.fill();
  // Cut the slits out of the lower half, widening toward the bottom.
  sctx.globalCompositeOperation = 'destination-out';
  let y = pad + r * 0.05;
  let gap = r * 0.045;
  while (y < pad + r) {
    sctx.fillRect(0, y, pad * 2, gap);
    y += gap + r * 0.13;
    gap *= 1.5;
  }
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.drawImage(sun, cx - pad, cy - pad);
  ctx.restore();
}

/** One grade pass: layered composite fills, all scaled by `t` (0..1). */
function applyGrade(ctx, w, h, grade, t) {
  if (t <= 0) return;
  const overlay = (fill, mode, alpha) => {
    ctx.save();
    ctx.globalCompositeOperation = mode;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  };
  const gradient = (stops, mode, alpha) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    for (const [at, color] of stops) g.addColorStop(at, color);
    overlay(g, mode, alpha);
  };
  if (grade === 'vice-sunset') {
    gradient([[0, '#ffb347'], [0.55, '#ff6b6b'], [1, '#c2187a']], 'soft-light', 0.6 * t);
    gradient([[0, 'rgba(255, 140, 60, 0)'], [1, 'rgba(194, 24, 122, 0.55)']], 'multiply', 0.5 * t);
    gradient([[0, 'rgba(255, 180, 90, 0.35)'], [1, 'rgba(255, 180, 90, 0)']], 'screen', 0.35 * t);
  } else if (grade === 'neon-nights') {
    overlay('#2a0a4a', 'multiply', 0.45 * t);
    gradient([[0, 'rgba(34, 211, 238, 0.5)'], [0.5, 'rgba(34, 211, 238, 0)']], 'screen', 0.5 * t);
    gradient([[0.5, 'rgba(255, 46, 136, 0)'], [1, 'rgba(255, 46, 136, 0.55)']], 'screen', 0.5 * t);
    gradient([[0, '#7c3aed'], [1, '#0ea5e9']], 'overlay', 0.25 * t);
  } else if (grade === 'golden-hour') {
    gradient([[0, '#ffe9a8'], [1, '#ff9a3d']], 'soft-light', 0.65 * t);
    overlay('#ffb347', 'overlay', 0.3 * t);
    gradient([[0, 'rgba(255, 220, 140, 0.3)'], [1, 'rgba(255, 220, 140, 0)']], 'screen', 0.3 * t);
  } else if (grade === 'retro-chrome') {
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = 0.75 * t;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    gradient([[0, '#e0e7ff'], [1, '#1e293b']], 'overlay', 0.3 * t);
    gradient([[0, 'rgba(255,255,255,0.25)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,0.3)']], 'soft-light', 0.5 * t);
  }
}

/** The lettering: auto-fit Anton caption, outline, neon glow, subtitle. */
function drawLettering(ctx, state, w, h) {
  const zone = LAYOUTS[state.layout].caption;
  const caption = state.caption.trim().toUpperCase();
  const subtitle = state.subtitle.trim().toUpperCase();
  const maxWidth = zone.width * w;
  let size = Math.min(w, h) * 0.115 * state.captionSize;
  ctx.textAlign = zone.align;
  ctx.textBaseline = 'alphabetic';
  const x = zone.x * w;
  const y = zone.y * h;
  if (caption) {
    ctx.font = `${size}px ${FONT_FAMILY}`;
    while (ctx.measureText(caption).width > maxWidth && size > 10) {
      size -= 2;
      ctx.font = `${size}px ${FONT_FAMILY}`;
    }
    if (state.neon) {
      ctx.save();
      ctx.shadowColor = '#ff2e88';
      ctx.shadowBlur = size * 0.45;
      ctx.fillStyle = state.captionColor;
      ctx.fillText(caption, x, y);
      ctx.restore();
    }
    if (state.outline) {
      ctx.lineWidth = Math.max(2, size * 0.09);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#160a24';
      ctx.strokeText(caption, x, y);
    }
    ctx.fillStyle = state.captionColor;
    ctx.fillText(caption, x, y);
  }
  if (subtitle) {
    const subSize = Math.max(10, size * 0.22);
    ctx.font = `600 ${subSize}px "Arial Narrow", system-ui, sans-serif`;
    // Letterspaced subtitle, drawn glyph by glyph for exact spacing.
    const spacing = subSize * 0.32;
    const total = [...subtitle].reduce((sum, ch) => sum + ctx.measureText(ch).width + spacing, -spacing);
    let sx = zone.align === 'center' ? x - total / 2 : x;
    if (zone.align === 'right') sx = x - total;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = subSize * 0.3;
    for (const ch of subtitle) {
      ctx.fillText(ch, sx, y + subSize * 1.5);
      sx += ctx.measureText(ch).width + spacing;
    }
    ctx.shadowBlur = 0;
  }
}

/**
 * Renders `state` onto `canvas` (any size) using `images`, a map from photo
 * key to a loaded image element. The same call draws the preview and, on an
 * offscreen canvas, each exported PNG.
 */
export function renderCover(canvas, state, images) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#14081f';
  ctx.fillRect(0, 0, w, h);
  const layout = LAYOUTS[state.layout];
  layout.panels.forEach((panel, i) => {
    const slot = state.panels[i];
    drawPanelPhoto(ctx, slot ? images[slot.photo] : null, panel.points, slot ?? { zoom: 1, panX: 0, panY: 0 }, w, h);
  });
  if (GRADES[state.grade].sun) drawRetroSun(ctx, w, h, state.grade);
  applyGrade(ctx, w, h, state.grade, state.gradeIntensity);
  // Deterministic grain, stamped as a tiled pattern at low alpha.
  const tile = getGrainTile();
  const pattern = ctx.createPattern(tile, 'repeat');
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  // Vignette: darken the corners so the lettering pops.
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(10, 4, 18, 0)');
  vg.addColorStop(1, 'rgba(10, 4, 18, 0.42)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  drawLettering(ctx, state, w, h);
}
