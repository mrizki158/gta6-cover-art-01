// The canvas renderer: draws a cover state onto any 2D canvas at any
// size, so the on-screen preview and the exported PNGs are the same
// drawing. The draw is a pipeline of small stages, run in order — each
// stage is its own function taking the same frame object, so a stage can
// be reordered, skipped or added without touching the others:
//
//   photos -> retro sun -> colour grade -> duotone -> caption band
//        -> film grain -> vignette -> lettering
//
// Photos are drawn cover-fit per cell with the frame's own zoom and pan,
// so one photo can fill every cell or each cell can hold a different one.
// The grain comes from a fixed seed, so two renders of the same state are
// pixel-identical — the preview and the export always match.

import { resolveLayout, GRADES } from './scene.js';

const DISPLAY_FONT = '"Anton", "Arial Narrow", sans-serif';

/** A tiny deterministic PRNG (mulberry32) so the grain never flickers. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One 128 x 128 grain tile, built once and stamped across the canvas. The
 * speckle mixes bright and dark grains (two-tone) instead of a flat grey
 * noise, which reads as film grain rather than a dirty overlay at export
 * size. The tile is cached on the module so repeat renders stay cheap.
 */
let cachedTile = null;
function grainTile() {
  if (cachedTile) return cachedTile;
  const tile = document.createElement('canvas');
  tile.width = 128;
  tile.height = 128;
  const tctx = tile.getContext('2d');
  const pixels = tctx.createImageData(128, 128);
  const rand = seededRandom(0x9e3779b9);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const bright = rand() > 0.5;
    const value = bright ? 200 + Math.floor(rand() * 55) : Math.floor(rand() * 55);
    pixels.data[i] = value;
    pixels.data[i + 1] = value;
    pixels.data[i + 2] = value;
    pixels.data[i + 3] = bright ? 22 : 30;
  }
  tctx.putImageData(pixels, 0, 0);
  cachedTile = tile;
  return tile;
}

/** Shrinks a polygon a little toward its centroid, opening a dark gutter. */
function shrinkTowardCentroid(corners, amount) {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of corners) {
    cx += x;
    cy += y;
  }
  cx /= corners.length;
  cy /= corners.length;
  return corners.map(([x, y]) => [cx + (x - cx) * (1 - amount), cy + (y - cy) * (1 - amount)]);
}

/** Traces a unit-coordinate polygon onto the canvas, scaled to w x h. */
function traceCell(ctx, corners, w, h) {
  ctx.beginPath();
  corners.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x * w, y * h);
    else ctx.lineTo(x * w, y * h);
  });
  ctx.closePath();
}

/** The cell's bounding box in unit coordinates. */
function cellBounds(corners) {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const [x, y] of corners) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/** Draws one photo cover-fit inside a clipped polygon, with zoom and pan. */
function paintCellPhoto(ctx, img, corners, frame, w, h) {
  if (!img) return;
  ctx.save();
  traceCell(ctx, shrinkTowardCentroid(corners, 0.006), w, h);
  ctx.clip();
  const { minX, minY, maxX, maxY } = cellBounds(corners);
  const boxW = (maxX - minX) * w;
  const boxH = (maxY - minY) * h;
  const scale = Math.max(boxW / img.naturalWidth, boxH / img.naturalHeight) * frame.zoom;
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const centreX = minX * w + boxW / 2 + frame.panX * boxW;
  const centreY = minY * h + boxH / 2 + frame.panY * boxH;
  ctx.drawImage(img, centreX - drawW / 2, centreY - drawH / 2, drawW, drawH);
  ctx.restore();
}

/**
 * Stage: photos. Every cell of the active layout gets its frame's photo,
 * clipped to the cell polygon. A missing frame draws nothing — the dark
 * backing shows through instead of throwing.
 */
function stagePhotos(frame, cover, images) {
  const { ctx, w, h } = frame;
  const layout = resolveLayout(cover.layout);
  layout.cells.forEach((cell, i) => {
    const slot = cover.frames[i] ?? { zoom: 1, panX: 0, panY: 0 };
    paintCellPhoto(ctx, slot ? images[slot.photo] : null, cell.corners, slot, w, h);
  });
}

/**
 * Stage: the retro sun. A warm disc with horizontal slits, upper right.
 * The disc and its slits are drawn on an offscreen canvas first, so
 * cutting the slits erases only the sun — the photo beneath shows through
 * them. Only grades with `sun` draw it.
 */
function stageSun(frame, cover) {
  const { ctx, w, h } = frame;
  if (!GRADES[cover.grade].sun) return;
  const radius = Math.min(w, h) * 0.13;
  const cx = w * 0.74;
  const cy = h * 0.17;
  ctx.save();
  const halo = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 2.2);
  halo.addColorStop(0, cover.grade === 'golden-hour' ? 'rgba(255, 190, 80, 0.5)' : 'rgba(255, 90, 140, 0.45)');
  halo.addColorStop(1, 'rgba(255, 90, 140, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(cx - radius * 2.2, cy - radius * 2.2, radius * 4.4, radius * 4.4);
  ctx.restore();

  // Disc + slits on their own canvas, then stamped over the photo.
  const pad = Math.ceil(radius * 1.1);
  const sun = document.createElement('canvas');
  sun.width = pad * 2;
  sun.height = pad * 2;
  const sctx = sun.getContext('2d');
  const disc = sctx.createLinearGradient(0, pad - radius, 0, pad + radius);
  if (cover.grade === 'golden-hour') {
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
  sctx.arc(pad, pad, radius, 0, Math.PI * 2);
  sctx.fill();
  // Cut the slits out of the lower half, widening toward the bottom.
  sctx.globalCompositeOperation = 'destination-out';
  let slitY = pad + radius * 0.05;
  let slitGap = radius * 0.045;
  while (slitY < pad + radius) {
    sctx.fillRect(0, slitY, pad * 2, slitGap);
    slitY += slitGap + radius * 0.13;
    slitGap *= 1.5;
  }
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.drawImage(sun, cx - pad, cy - pad);
  ctx.restore();
}

/** Helper for grade stages: one fill or gradient, one blend mode, one alpha. */
function wash(ctx, w, h, fill, mode, alpha) {
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Helper for grade stages: a vertical gradient wash. */
function gradientWash(ctx, w, h, stops, mode, alpha) {
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  for (const [at, color] of stops) gradient.addColorStop(at, color);
  wash(ctx, w, h, gradient, mode, alpha);
}

/**
 * Stage: the colour grade. Layered composite fills, all scaled by `t`
 * (0..1, the grade-intensity slider). The sunset stack is a four-stop
 * warm gradient with a magenta horizon lift at the bottom, a soft amber
 * glow up top, and a cool shadow tint so the lettering band stays
 * readable. Each grade is its own branch so its stack reads as one
 * recipe, not a tangle of conditionals.
 */
function stageGrade(frame, cover) {
  const { ctx, w, h } = frame;
  const t = cover.gradeIntensity;
  if (t <= 0) return;
  if (cover.grade === 'vice-sunset') {
    gradientWash(ctx, w, h, [[0, '#ffd166'], [0.35, '#ff9e5e'], [0.68, '#ff5e7a'], [1, '#b3126e']], 'soft-light', 0.62 * t);
    gradientWash(ctx, w, h, [[0, 'rgba(255, 140, 60, 0)'], [0.7, 'rgba(255, 80, 120, 0.22)'], [1, 'rgba(179, 18, 110, 0.6)']], 'multiply', 0.5 * t);
    gradientWash(ctx, w, h, [[0, 'rgba(255, 190, 100, 0.38)'], [0.45, 'rgba(255, 190, 100, 0.08)'], [1, 'rgba(255, 190, 100, 0)']], 'screen', 0.38 * t);
    gradientWash(ctx, w, h, [[0, 'rgba(40, 10, 60, 0)'], [1, 'rgba(40, 10, 60, 0.35)']], 'multiply', 0.4 * t);
  } else if (cover.grade === 'neon-nights') {
    wash(ctx, w, h, '#2a0a4a', 'multiply', 0.45 * t);
    gradientWash(ctx, w, h, [[0, 'rgba(34, 211, 238, 0.5)'], [0.5, 'rgba(34, 211, 238, 0)']], 'screen', 0.5 * t);
    gradientWash(ctx, w, h, [[0.5, 'rgba(255, 46, 136, 0)'], [1, 'rgba(255, 46, 136, 0.55)']], 'screen', 0.5 * t);
    gradientWash(ctx, w, h, [[0, '#7c3aed'], [1, '#0ea5e9']], 'overlay', 0.25 * t);
  } else if (cover.grade === 'golden-hour') {
    gradientWash(ctx, w, h, [[0, '#ffe9a8'], [0.5, '#ffc46b'], [1, '#ff9a3d']], 'soft-light', 0.65 * t);
    wash(ctx, w, h, '#ffb347', 'overlay', 0.3 * t);
    gradientWash(ctx, w, h, [[0, 'rgba(255, 220, 140, 0.3)'], [1, 'rgba(255, 220, 140, 0)']], 'screen', 0.3 * t);
  } else if (cover.grade === 'retro-chrome') {
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = 0.75 * t;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    gradientWash(ctx, w, h, [[0, '#e0e7ff'], [1, '#1e293b']], 'overlay', 0.3 * t);
    gradientWash(ctx, w, h, [[0, 'rgba(255,255,255,0.25)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,0.3)']], 'soft-light', 0.5 * t);
  }
}

/** Parses a '#rrggbb' colour into its red, green and blue channels. */
function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/**
 * Stage: duotone. When the toggle is on, every pixel of the graded photo
 * layer is remapped to the grade's two tones: the pixel's luminance picks
 * a point on the line from the shadow tone to the light tone, so shadows
 * go deep purple (or navy, or umber — per grade) and highlights go warm
 * amber (or cyan, or gold) while the photo's own contrast survives. The
 * remap is a per-pixel pass over the canvas, which keeps the tones exact
 * — a multiply-then-screen wash would crush the mid-tones flat. It runs
 * before the band and the lettering, so the caption stays full-colour
 * and readable on top of the two-tone art.
 */
function stageDuotone(frame, cover) {
  const { ctx, w, h } = frame;
  if (!cover.duotone) return;
  const duo = GRADES[cover.grade].duo;
  const shadow = hexToRgb(duo.shadow);
  const light = hexToRgb(duo.light);
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
    // A slight lift keeps the deepest shadows from going pure tone.
    const t = Math.min(1, Math.max(0, (luminance - 0.04) * 1.08));
    data[i] = shadow.r + (light.r - shadow.r) * t;
    data[i + 1] = shadow.g + (light.g - shadow.g) * t;
    data[i + 2] = shadow.b + (light.b - shadow.b) * t;
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * Stage: the caption band. For layouts with a `band`, a dark gradient
 * washes the bottom of the cover so the lettering reads on any photo, and
 * a neon line marks where the cells end and the band begins. Sunset Strip
 * also gets a glowing divider along its thin side strip, so the strip
 * reads as a deliberate film edge rather than a crop accident.
 */
function stageBand(frame, cover) {
  const { ctx, w, h } = frame;
  const layout = resolveLayout(cover.layout);
  if (layout.band == null) return;
  const bandY = layout.band * h;
  const fade = ctx.createLinearGradient(0, bandY - h * 0.06, 0, h);
  fade.addColorStop(0, 'rgba(16, 6, 28, 0)');
  fade.addColorStop(0.35, 'rgba(16, 6, 28, 0.72)');
  fade.addColorStop(1, 'rgba(16, 6, 28, 0.94)');
  ctx.save();
  ctx.fillStyle = fade;
  ctx.fillRect(0, bandY - h * 0.06, w, h - bandY + h * 0.06);
  ctx.restore();

  const divider = ctx.createLinearGradient(0, bandY, w, bandY);
  divider.addColorStop(0, 'rgba(34, 211, 238, 0)');
  divider.addColorStop(0.5, 'rgba(34, 211, 238, 0.9)');
  divider.addColorStop(1, 'rgba(255, 46, 136, 0)');
  ctx.save();
  ctx.fillStyle = divider;
  ctx.shadowColor = '#ff2e88';
  ctx.shadowBlur = Math.max(4, h * 0.008);
  ctx.fillRect(0, bandY - Math.max(1.5, h * 0.002), w, Math.max(3, h * 0.004));
  ctx.restore();

  if (layout.strip != null) {
    const stripX = layout.strip * w;
    const edge = ctx.createLinearGradient(stripX, 0, stripX, bandY);
    edge.addColorStop(0, 'rgba(255, 209, 102, 0.95)');
    edge.addColorStop(1, 'rgba(255, 46, 136, 0.95)');
    ctx.save();
    ctx.fillStyle = edge;
    ctx.shadowColor = '#ff2e88';
    ctx.shadowBlur = Math.max(3, h * 0.006);
    ctx.fillRect(stripX - Math.max(1.5, h * 0.002), 0, Math.max(3, h * 0.004), bandY);
    ctx.restore();
  }
}

/** Stage: deterministic film grain, stamped as a tiled pattern. */
function stageGrain(frame) {
  const { ctx, w, h } = frame;
  const tile = grainTile();
  const pattern = ctx.createPattern(tile, 'repeat');
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * Stage: a two-step vignette — a soft darkening toward the edges, then a
 * stronger pull at the corners, so the lettering pops without muddying
 * the middle of the cover.
 */
function stageVignette(frame) {
  const { ctx, w, h } = frame;
  const shade = ctx.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.38,
    w / 2, h / 2, Math.max(w, h) * 0.72,
  );
  shade.addColorStop(0, 'rgba(10, 4, 18, 0)');
  shade.addColorStop(0.7, 'rgba(10, 4, 18, 0.18)');
  shade.addColorStop(1, 'rgba(10, 4, 18, 0.46)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
}

/** Shrinks the caption font until the text fits its zone's max width. */
function fitCaption(ctx, text, zone, w, h, scale) {
  let size = Math.min(w, h) * 0.115 * scale;
  const limit = zone.maxWidth * w;
  ctx.font = `${size}px ${DISPLAY_FONT}`;
  while (ctx.measureText(text).width > limit && size > 10) {
    size -= 2;
    ctx.font = `${size}px ${DISPLAY_FONT}`;
  }
  return size;
}

/** Draws the subtitle letterspaced, glyph by glyph, for exact spacing. */
function paintSubtitle(ctx, text, zone, x, y, size) {
  const subSize = Math.max(10, size * 0.22);
  ctx.font = `600 ${subSize}px "Arial Narrow", system-ui, sans-serif`;
  const gap = subSize * 0.32;
  const total = [...text].reduce((sum, ch) => sum + ctx.measureText(ch).width + gap, -gap);
  let startX = zone.align === 'center' ? x - total / 2 : x;
  if (zone.align === 'right') startX = x - total;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = subSize * 0.3;
  for (const ch of text) {
    ctx.fillText(ch, startX, y + subSize * 1.5);
    startX += ctx.measureText(ch).width + gap;
  }
  ctx.shadowBlur = 0;
}

/**
 * Stage: the lettering — auto-fit Anton caption, outline, neon glow,
 * subtitle. The outline width follows `cover.outlineWidth`, so the new
 * outline slider works on every layout — including Sunset Strip, whose
 * caption sits on the band.
 */
function stageLettering(frame, cover) {
  const { ctx, w, h } = frame;
  const zone = resolveLayout(cover.layout).caption;
  const caption = cover.caption.trim().toUpperCase();
  const subtitle = cover.subtitle.trim().toUpperCase();
  ctx.textAlign = zone.align;
  ctx.textBaseline = 'alphabetic';
  const x = zone.x * w;
  const y = zone.y * h;
  let size = 0;
  if (caption) {
    size = fitCaption(ctx, caption, zone, w, h, cover.captionSize);
    if (cover.neon) {
      ctx.save();
      ctx.shadowColor = '#ff2e88';
      ctx.shadowBlur = size * 0.45;
      ctx.fillStyle = cover.captionColor;
      ctx.fillText(caption, x, y);
      ctx.restore();
    }
    if (cover.outline) {
      ctx.lineWidth = Math.max(1, size * 0.09 * (cover.outlineWidth ?? 1));
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#160a24';
      ctx.strokeText(caption, x, y);
    }
    ctx.fillStyle = cover.captionColor;
    ctx.fillText(caption, x, y);
  }
  if (subtitle) {
    if (size === 0) size = Math.min(w, h) * 0.115 * cover.captionSize;
    paintSubtitle(ctx, subtitle, zone, x, y, size);
  }
}

/**
 * The pipeline, in draw order. Each entry is a stage function taking
 * (frame, cover, images); stages that need no images ignore the third
 * argument. The order is the whole look of the cover: photos first, the
 * grade and duotone over them, the band and grain over that, the
 * vignette, and the lettering last so it always sits on top.
 */
export const PIPELINE = [
  stagePhotos,
  stageSun,
  stageGrade,
  stageDuotone,
  stageBand,
  stageGrain,
  stageVignette,
  stageLettering,
];

/**
 * Renders `cover` onto `canvas` (any size) using `images`, a map from
 * photo key to a loaded image element. The same call draws the preview
 * and, on an offscreen canvas, each exported PNG.
 */
export function renderCover(canvas, cover, images) {
  const ctx = canvas.getContext('2d');
  const frame = { ctx, w: canvas.width, h: canvas.height };
  ctx.clearRect(0, 0, frame.w, frame.h);
  ctx.fillStyle = '#14081f';
  ctx.fillRect(0, 0, frame.w, frame.h);
  for (const stage of PIPELINE) stage(frame, cover, images);
}
