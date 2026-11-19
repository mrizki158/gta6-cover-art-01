// The cover's scene graph: five multi-panel layouts, each a list of polygons in
// unit coordinates (0..1 across the canvas), plus where the lettering sits.
// Everything the renderer draws comes from this one graph, so switching a layout
// is a single click and an export re-renders the very same graph at full size.
//
// A panel is { points: [[x, y], ...] } in clockwise order. Panels are drawn in
// order; the renderer insets each polygon a hair toward its own centroid so the
// seams read as deliberate dark gutters instead of hairline cracks.

/** Every layout the studio offers, keyed by id, in menu order. */
export const LAYOUTS = {
  'vice-grid': {
    name: 'Vice Grid',
    blurb: '2 x 2 with a slashed seam',
    caption: { x: 0.5, y: 0.9, align: 'center', width: 0.92 },
    panels: [
      { points: [[0, 0], [0.53, 0], [0.47, 0.5], [0, 0.5]] },
      { points: [[0.53, 0], [1, 0], [1, 0.5], [0.47, 0.5]] },
      { points: [[0, 0.5], [0.47, 0.5], [0.53, 1], [0, 1]] },
      { points: [[0.47, 0.5], [1, 0.5], [1, 1], [0.53, 1]] },
    ],
  },
  'hero-strips': {
    name: 'Hero + Strips',
    blurb: 'One big hero, two side strips',
    caption: { x: 0.3, y: 0.88, align: 'center', width: 0.56 },
    panels: [
      { points: [[0, 0], [0.62, 0], [0.58, 1], [0, 1]] },
      { points: [[0.62, 0], [1, 0], [1, 0.5], [0.6, 0.5]] },
      { points: [[0.6, 0.5], [1, 0.5], [1, 1], [0.58, 1]] },
    ],
  },
  'banner-trio': {
    name: 'Banner Trio',
    blurb: 'Wide banner over three panels',
    caption: { x: 0.5, y: 0.34, align: 'center', width: 0.9 },
    panels: [
      { points: [[0, 0], [1, 0], [1, 0.42], [0, 0.42]] },
      { points: [[0, 0.42], [0.35, 0.42], [0.31, 1], [0, 1]] },
      { points: [[0.35, 0.42], [0.68, 0.42], [0.64, 1], [0.31, 1]] },
      { points: [[0.68, 0.42], [1, 0.42], [1, 1], [0.64, 1]] },
    ],
  },
  'diagonal-trio': {
    name: 'Diagonal Trio',
    blurb: 'Three slanted slices',
    caption: { x: 0.5, y: 0.9, align: 'center', width: 0.92 },
    panels: [
      { points: [[0, 0], [0.42, 0], [0.22, 1], [0, 1]] },
      { points: [[0.42, 0], [0.74, 0], [0.54, 1], [0.22, 1]] },
      { points: [[0.74, 0], [1, 0], [1, 1], [0.54, 1]] },
    ],
  },
  'sunset-strip': {
    name: 'Sunset Strip',
    blurb: 'Full-bleed hero over a filmstrip',
    caption: { x: 0.5, y: 0.62, align: 'center', width: 0.9 },
    panels: [
      { points: [[0, 0], [1, 0], [1, 0.74], [0, 0.74]] },
      { points: [[0.015, 0.765], [0.325, 0.765], [0.325, 0.985], [0.015, 0.985]] },
      { points: [[0.345, 0.765], [0.655, 0.765], [0.655, 0.985], [0.345, 0.985]] },
      { points: [[0.675, 0.765], [0.985, 0.765], [0.985, 0.985], [0.675, 0.985]] },
    ],
  },
};

/** The four colour grades, in menu order. */
export const GRADES = {
  'vice-sunset': { name: 'Vice Sunset', sun: true },
  'neon-nights': { name: 'Neon Nights', sun: false },
  'golden-hour': { name: 'Golden Hour', sun: true },
  'retro-chrome': { name: 'Retro Chrome', sun: false },
};

/** The post sizes the studio exports, in menu order. */
export const EXPORT_SIZES = [
  { id: 'square', label: '1080 x 1080', w: 1080, h: 1080 },
  { id: 'portrait', label: '1080 x 1350', w: 1080, h: 1350 },
  { id: 'wide', label: '1920 x 1080', w: 1920, h: 1080 },
];

/**
 * A fresh cover state: the default layout, grade and lettering, and one panel
 * slot per panel of the default layout. Panel slots carry their own photo,
 * zoom and pan, so each panel can hold a different photo or share one.
 */
export function createState() {
  return {
    layout: 'vice-grid',
    grade: 'vice-sunset',
    gradeIntensity: 0.8,
    caption: 'NEON SUNSET',
    subtitle: 'A NEON COAST STORY',
    captionSize: 1,
    captionColor: '#ffffff',
    outline: true,
    neon: true,
    selectedPanel: 0,
    panels: panelSlots('vice-grid', 'pier'),
  };
}

/** One panel slot per panel of `layoutId`, all starting on `photoKey`. */
export function panelSlots(layoutId, photoKey) {
  return LAYOUTS[layoutId].panels.map(() => ({
    photo: photoKey,
    zoom: 1,
    panX: 0,
    panY: 0,
  }));
}

/**
 * Switches the layout, keeping each panel's photo where a panel of the same
 * index exists and filling new panels with the first panel's photo.
 */
export function applyLayout(state, layoutId) {
  const keep = state.panels;
  const firstPhoto = keep[0]?.photo ?? 'pier';
  state.layout = layoutId;
  state.panels = LAYOUTS[layoutId].panels.map((_, i) => keep[i] ?? {
    photo: firstPhoto,
    zoom: 1,
    panX: 0,
    panY: 0,
  });
  state.selectedPanel = 0;
}

/** Puts `photoKey` in every panel at once. */
export function applyPhotoToAll(state, photoKey) {
  for (const slot of state.panels) slot.photo = photoKey;
}

/** True when the unit point (x, y) falls inside the panel's polygon. */
export function pointInPanel(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The index of the topmost panel under the unit point, or -1. */
export function panelAt(state, x, y) {
  const panels = LAYOUTS[state.layout].panels;
  for (let i = panels.length - 1; i >= 0; i--) {
    if (pointInPanel(panels[i].points, x, y)) return i;
  }
  return -1;
}
