// Cover Studio scene registry — the data behind every cover the app draws.
//
// Instead of one hard-coded graph, every layout is a small config object
// registered here: a list of photo cells (unit-coordinate polygons), where
// the caption zone sits, and, for banded layouts, where the photo area ends
// and the caption band begins. The renderer never knows a layout by name;
// it asks the registry for the active layout and draws whatever cells it
// describes, so adding a layout is one config object, not a code change.
//
// A cell is { corners: [[x, y], ...] } in clockwise order, in unit
// coordinates (0..1 across the canvas). Cells draw in order, so a later
// cell paints over an earlier one — that is how Sunset Strip puts its thin
// side strip on top of the full-bleed hero photo underneath it. The
// renderer insets each cell a hair toward its own centroid so the seams
// read as deliberate dark gutters instead of hairline cracks.
//
// A layout may carry `band` (the y where its cells end and the caption band
// begins; the renderer paints a dark gradient band and a neon divider
// there) and `strip` (the x where a thin vertical side strip starts, for
// layouts whose hero runs full-bleed underneath it).

const registry = new Map();

/**
 * Registers one layout config under `id`. The config is frozen so a typo
 * in a later edit cannot silently mutate a layout mid-session.
 */
function defineLayout(id, spec) {
  registry.set(id, Object.freeze({
    id,
    title: spec.title,
    tagline: spec.tagline,
    kind: spec.kind,
    band: spec.band ?? null,
    strip: spec.strip ?? null,
    caption: Object.freeze({ ...spec.caption }),
    cells: Object.freeze(spec.cells.map((corners) => Object.freeze({ corners: Object.freeze(corners) }))),
  }));
}

// The flagship: a clean 2 x 2 grid of square photos over a caption band.
// The grid owns the top 78% of the cover; the lettering owns the strip
// below it, so a long caption never crowds the photos.
defineLayout('vice-grid', {
  title: 'Vice Grid',
  tagline: '2 x 2 grid over a caption band',
  kind: 'grid-band',
  band: 0.78,
  caption: { x: 0.5, y: 0.93, align: 'center', maxWidth: 0.92 },
  cells: [
    [[0, 0], [0.5, 0], [0.5, 0.39], [0, 0.39]],
    [[0.5, 0], [1, 0], [1, 0.39], [0.5, 0.39]],
    [[0, 0.39], [0.5, 0.39], [0.5, 0.78], [0, 0.78]],
    [[0.5, 0.39], [1, 0.39], [1, 0.78], [0.5, 0.78]],
  ],
});

// Four slanted quadrants meeting at a crossed seam — the old grid, kept
// for covers that want the diagonal energy instead of the tidy grid.
defineLayout('slash-quad', {
  title: 'Slash Quad',
  tagline: 'Four slanted quadrants, crossed seam',
  kind: 'grid',
  caption: { x: 0.5, y: 0.9, align: 'center', maxWidth: 0.92 },
  cells: [
    [[0, 0], [0.52, 0], [0.48, 0.5], [0, 0.5]],
    [[0.52, 0], [1, 0], [1, 0.5], [0.48, 0.5]],
    [[0, 0.5], [0.48, 0.5], [0.52, 1], [0, 1]],
    [[0.48, 0.5], [1, 0.5], [1, 1], [0.52, 1]],
  ],
});

// One big hero on the left, two stacked strips on the right.
defineLayout('hero-strips', {
  title: 'Hero + Strips',
  tagline: 'One big hero, two side strips',
  kind: 'hero',
  caption: { x: 0.3, y: 0.88, align: 'center', maxWidth: 0.56 },
  cells: [
    [[0, 0], [0.62, 0], [0.58, 1], [0, 1]],
    [[0.62, 0], [1, 0], [1, 0.5], [0.6, 0.5]],
    [[0.6, 0.5], [1, 0.5], [1, 1], [0.58, 1]],
  ],
});

// A wide banner across the top, three tall panels underneath it.
defineLayout('banner-trio', {
  title: 'Banner Trio',
  tagline: 'Wide banner over three panels',
  kind: 'banner',
  caption: { x: 0.5, y: 0.34, align: 'center', maxWidth: 0.9 },
  cells: [
    [[0, 0], [1, 0], [1, 0.42], [0, 0.42]],
    [[0, 0.42], [0.35, 0.42], [0.31, 1], [0, 1]],
    [[0.35, 0.42], [0.68, 0.42], [0.64, 1], [0.31, 1]],
    [[0.68, 0.42], [1, 0.42], [1, 1], [0.64, 1]],
  ],
});

// Three slices leaning the same way, like a deck of cards fanned out.
defineLayout('diagonal-trio', {
  title: 'Diagonal Trio',
  tagline: 'Three slanted slices',
  kind: 'diagonal',
  caption: { x: 0.5, y: 0.9, align: 'center', maxWidth: 0.92 },
  cells: [
    [[0, 0], [0.42, 0], [0.22, 1], [0, 1]],
    [[0.42, 0], [0.74, 0], [0.54, 1], [0.22, 1]],
    [[0.74, 0], [1, 0], [1, 1], [0.54, 1]],
  ],
});

// A full-bleed hero over a three-frame filmstrip along the bottom.
defineLayout('sunset-filmstrip', {
  title: 'Sunset Filmstrip',
  tagline: 'Full-bleed hero over a filmstrip',
  kind: 'filmstrip',
  caption: { x: 0.5, y: 0.62, align: 'center', maxWidth: 0.9 },
  cells: [
    [[0, 0], [1, 0], [1, 0.74], [0, 0.74]],
    [[0.015, 0.765], [0.325, 0.765], [0.325, 0.985], [0.015, 0.985]],
    [[0.345, 0.765], [0.655, 0.765], [0.655, 0.985], [0.345, 0.985]],
    [[0.675, 0.765], [0.985, 0.765], [0.985, 0.985], [0.675, 0.985]],
  ],
});

// Two tall angled panels; the caption band owns the bottom fifth.
defineLayout('neon-diptych', {
  title: 'Neon Diptych',
  tagline: 'Two tall angled panels over a caption band',
  kind: 'banded',
  band: 0.78,
  caption: { x: 0.5, y: 0.93, align: 'center', maxWidth: 0.92 },
  cells: [
    [[0, 0], [0.54, 0], [0.46, 0.78], [0, 0.78]],
    [[0.54, 0], [1, 0], [1, 0.78], [0.46, 0.78]],
  ],
});

// The hero photo runs edge to edge; the band owns the bottom fifth and a
// thin vertical strip on the right edge carries a second photo.
defineLayout('sunset-strip', {
  title: 'Sunset Strip',
  tagline: 'Full-bleed hero, caption band, thin side strip',
  kind: 'banded',
  band: 0.8,
  strip: 0.93,
  caption: { x: 0.46, y: 0.93, align: 'center', maxWidth: 0.86 },
  cells: [
    [[0, 0], [1, 0], [1, 1], [0, 1]],
    [[0.93, 0], [1, 0], [1, 0.8], [0.93, 0.8]],
  ],
});

/** Layout ids in menu order — the order the picker shows them. */
export const LAYOUT_IDS = [...registry.keys()];

/**
 * The layout registry as a plain object, for pickers that iterate entries.
 * Built once from the registry so the object and the id list cannot drift.
 */
export const LAYOUTS = Object.fromEntries(registry.entries());

/**
 * Resolves a layout id to its config, falling back to the flagship Vice
 * Grid when an unknown id arrives (a stale link, a typo in a shot query).
 * Never throws on bad input — the studio always has a layout to draw.
 */
export function resolveLayout(id) {
  return registry.get(id) ?? registry.get('vice-grid');
}

/** The four colour grades, in menu order, each with its duotone pair. */
export const GRADES = {
  'vice-sunset': {
    name: 'Vice Sunset',
    sun: true,
    duo: { shadow: '#2b0a4e', light: '#ff9e5e' },
  },
  'neon-nights': {
    name: 'Neon Nights',
    sun: false,
    duo: { shadow: '#0b1035', light: '#22d3ee' },
  },
  'golden-hour': {
    name: 'Golden Hour',
    sun: true,
    duo: { shadow: '#4a2400', light: '#ffe9a8' },
  },
  'retro-chrome': {
    name: 'Retro Chrome',
    sun: false,
    duo: { shadow: '#101828', light: '#e0e7ff' },
  },
};

/** The post sizes the studio exports, in menu order. */
export const EXPORT_SIZES = [
  { id: 'square', label: '1080 x 1080', w: 1080, h: 1080 },
  { id: 'portrait', label: '1080 x 1350', w: 1080, h: 1350 },
  { id: 'wide', label: '1920 x 1080', w: 1920, h: 1080 },
];

/**
 * Photo position presets: where the photo sits inside its frame. `top`
 * lifts the photo so a face near the top edge stays in frame; `face`
 * drops it a touch so a subject's face clears the caption band. Applied
 * as the frame's pan, so the user can still drag from there.
 */
export const PHOTO_POSITIONS = {
  center: { name: 'Center', panX: 0, panY: 0 },
  top: { name: 'Top', panX: 0, panY: -0.16 },
  face: { name: 'Face', panX: 0, panY: 0.14 },
};

/**
 * A fresh cover: the flagship layout, the sunset grade, and one frame per
 * cell of the layout. Frames carry their own photo, zoom and pan, so each
 * cell can hold a different photo or share one. `outlineWidth` scales the
 * caption outline (1 = the classic heavy outline).
 */
export function freshCover() {
  return {
    layout: 'vice-grid',
    grade: 'vice-sunset',
    gradeIntensity: 0.8,
    duotone: false,
    photoPosition: 'center',
    caption: 'NEON SUNSET',
    subtitle: 'A NEON COAST STORY',
    captionSize: 1,
    captionColor: '#ffffff',
    outline: true,
    outlineWidth: 1,
    neon: true,
    selectedFrame: 0,
    frames: buildFrames('vice-grid', 'pier'),
  };
}

/** One frame per cell of `layoutId`, all starting on `photoKey`. */
export function buildFrames(layoutId, photoKey) {
  return resolveLayout(layoutId).cells.map(() => ({
    photo: photoKey,
    zoom: 1,
    panX: 0,
    panY: 0,
  }));
}

/**
 * Switches the layout, keeping each frame's photo where a cell of the same
 * index exists and filling new cells with the first frame's photo. For the
 * banded Sunset Strip the hero keeps the first photo and the strip takes
 * the second frame's photo when one was set, so switching never blanks a
 * cell. The selection resets to the first frame.
 */
export function switchLayout(cover, layoutId) {
  const keep = cover.frames;
  const firstPhoto = keep[0]?.photo ?? 'pier';
  const secondPhoto = keep[1]?.photo ?? firstPhoto;
  cover.layout = layoutId;
  cover.frames = resolveLayout(layoutId).cells.map((_, i) => {
    if (keep[i]) return keep[i];
    return {
      photo: layoutId === 'sunset-strip' && i === 1 ? secondPhoto : firstPhoto,
      zoom: 1,
      panX: 0,
      panY: 0,
    };
  });
  cover.selectedFrame = 0;
}

/** Puts `photoKey` in every frame at once. */
export function fillAllFrames(cover, photoKey) {
  for (const frame of cover.frames) frame.photo = photoKey;
}

/**
 * Applies a photo position preset to the selected frame: sets its pan to
 * the preset's offsets and records the preset, so the picker can show
 * which preset is active. Dragging after that clears the preset marker
 * (the pan is custom then), handled by the studio's drag code.
 */
export function applyPhotoPosition(cover, presetId) {
  const preset = PHOTO_POSITIONS[presetId];
  if (!preset) return;
  const frame = cover.frames[cover.selectedFrame];
  if (!frame) return;
  frame.panX = preset.panX;
  frame.panY = preset.panY;
  cover.photoPosition = presetId;
}

/** True when the unit point (x, y) falls inside the cell's polygon. */
export function pointInCell(corners, x, y) {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const [xi, yi] = corners[i];
    const [xj, yj] = corners[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The index of the topmost cell under the unit point, or -1. Cells are
 * checked last-drawn first, so the Sunset Strip side strip wins over the
 * full-bleed hero beneath it on the right edge.
 */
export function frameUnderPoint(cover, x, y) {
  const cells = resolveLayout(cover.layout).cells;
  for (let i = cells.length - 1; i >= 0; i--) {
    if (pointInCell(cells[i].corners, x, y)) return i;
  }
  return -1;
}
