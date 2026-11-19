// Fixed scenes for screenshots: ?shot=editor shows the studio with a sample
// photo loaded; ?shot=cover shows the finished cover alone, filling the frame.
// `photo` picks the sample (samples/<photo>.jpg), `caption` the words, and
// `layout` / `grade` / `subtitle` pick the scene — shot 1 is the new Sunset
// Strip cover (full-bleed hero, caption band, thin side strip), shot 3 the
// Neon Diptych cover, two tall angled panels over the caption band.
// window.__shotReady is set once the font is in and the cover has painted, so
// a screenshot never catches a half-drawn frame.

import { LAYOUTS, GRADES, applyLayout, applyPhotoToAll } from './scene.js';

/**
 * Runs one shot scene, then flags readiness. The second sample goes into
 * the side panels so multi-photo covers stay honest: on Sunset Strip that
 * means the thin right-edge strip carries the other photo while the hero
 * keeps the main one.
 */
export async function runShot(shot, query, api) {
  const photo = query.get('photo') ?? 'pier';
  const caption = query.get('caption') ?? 'Sunset Heist';
  const subtitle = query.get('subtitle') ?? 'A NEON COAST STORY';
  const layout = query.get('layout') ?? 'vice-grid';
  const grade = query.get('grade') ?? 'vice-sunset';
  if (shot === 'cover') document.body.classList.add('shot-cover');
  api.fitPreview();
  if (LAYOUTS[layout]) applyLayout(api.state, layout);
  if (GRADES[grade]) api.state.grade = grade;
  api.state.caption = caption;
  api.state.subtitle = subtitle;
  await api.loadSample(photo);
  applyPhotoToAll(api.state, photo);
  // A second sample in the side panels keeps multi-photo covers honest.
  const other = photo === 'pier' ? 'boulevard' : 'pier';
  await api.loadSample(other);
  api.state.panels.forEach((slot, i) => {
    if (i > 0) slot.photo = i % 2 === 0 ? photo : other;
  });
  // Sunset Strip's strip is panel 1: give it the other photo outright, so
  // the strip is visibly a second frame rather than a sliver of the hero.
  if (layout === 'sunset-strip' && api.state.panels[1]) {
    api.state.panels[1].photo = other;
  }
  api.render();
  // A shot can ask for one control group in view (e.g. focus=export shows
  // the export-size menu at the top of the panel).
  const focus = query.get('focus');
  if (focus === 'export') {
    const row = document.getElementById('exportRow');
    if (row) row.closest('.group').scrollIntoView({ block: 'start' });
  }
  try {
    await document.fonts.load('16px Anton');
    await document.fonts.ready;
  } catch {
    // Anton missing is a degraded render, never a failed shot.
  }
  api.render();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.__shotReady = true;
  }));
}
