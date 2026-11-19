// Fixed scenes for screenshots: ?shot=editor shows the studio with a
// sample photo loaded; ?shot=cover shows the finished cover alone,
// filling the frame. The query picks the scene — `photo` the sample
// (samples/<photo>.jpg), `caption` the words, `layout` / `grade` /
// `subtitle` the look, `duotone=on` the new two-tone filter, and
// `position` the photo position preset (center / top / face). Shot 1 is
// the new Vice Grid cover in duotone with the sunset grade; shot 3 is a
// second cover in a different layout and grade, so the two covers show
// the studio's range. window.__shotReady is set once the font is in and
// the cover has painted, so a screenshot never catches a half-drawn
// frame.

import { LAYOUTS, GRADES, PHOTO_POSITIONS, switchLayout, fillAllFrames, applyPhotoPosition } from './scene.js';

/** Reads one shot parameter, falling back to `fallback` when absent. */
function shotParam(query, name, fallback) {
  return query.get(name) ?? fallback;
}

/** The other bundled sample, so multi-photo covers stay honest. */
function otherSample(photo) {
  return photo === 'pier' ? 'boulevard' : 'pier';
}

/**
 * Runs one shot scene, then flags readiness. The second sample goes into
 * the side frames so multi-photo covers stay honest: on Sunset Strip
 * that means the thin right-edge strip carries the other photo while the
 * hero keeps the main one, and on Vice Grid the bottom row alternates.
 */
export async function runShot(shot, query, api) {
  const photo = shotParam(query, 'photo', 'pier');
  const caption = shotParam(query, 'caption', 'Sunset Heist');
  const subtitle = shotParam(query, 'subtitle', 'A NEON COAST STORY');
  const layout = shotParam(query, 'layout', 'vice-grid');
  const grade = shotParam(query, 'grade', 'vice-sunset');
  const position = shotParam(query, 'position', 'center');
  const duotone = query.get('duotone') === 'on';

  if (shot === 'cover') document.body.classList.add('shot-cover');
  api.fitPreview();
  if (LAYOUTS[layout]) switchLayout(api.cover, layout);
  if (GRADES[grade]) api.cover.grade = grade;
  api.cover.caption = caption;
  api.cover.subtitle = subtitle;
  api.cover.duotone = duotone;
  if (PHOTO_POSITIONS[position]) applyPhotoPosition(api.cover, position);

  await api.loadSample(photo);
  fillAllFrames(api.cover, photo);
  // Keep the "Sample:" label honest about which photo the shot loaded.
  const photoName = document.getElementById('photoName');
  if (photoName) photoName.textContent = `Sample: ${photo}.jpg`;
  // Alternate the second sample through the later frames.
  const other = otherSample(photo);
  await api.loadSample(other);
  api.cover.frames.forEach((frame, i) => {
    if (i > 0) frame.photo = i % 2 === 0 ? photo : other;
  });
  // Sunset Strip's strip is frame 1: give it the other photo outright, so
  // the strip is visibly a second frame rather than a sliver of the hero.
  if (layout === 'sunset-strip' && api.cover.frames[1]) {
    api.cover.frames[1].photo = other;
  }
  // On a wide cover frame the full-bleed hero crops hard top and bottom,
  // so ease its photo down a touch: the subject stays in frame instead of
  // being cut by the top edge. The face preset does the same for Vice Grid.
  if (layout === 'sunset-strip' && api.cover.frames[0]) {
    api.cover.frames[0].panY = 0.15;
  }
  api.paint();
  // A shot can ask for one panel group in view (e.g. focus=export shows
  // the export-size menu at the top of the sidebar).
  const focus = query.get('focus');
  if (focus === 'export') {
    const row = document.getElementById('exportPicker');
    if (row) row.closest('.panel').scrollIntoView({ block: 'start' });
  }
  try {
    await document.fonts.load('16px Anton');
    await document.fonts.ready;
  } catch {
    // Anton missing is a degraded render, never a failed shot.
  }
  api.paint();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.__shotReady = true;
  }));
}
