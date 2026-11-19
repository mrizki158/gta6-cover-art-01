// Neon Sunset — the make.fun gta6-cover-art-01 entry program (Node 22,
// standard library only). It hands the app in: it checks the entry
// against the scorer's caps and against the studio's own feature list,
// copies this directory's app/ and screenshots/ to /output, and writes
// /output/dossier.json, the summary the judge reads, with the vendored
// make.fun library (vendor/makefun-app.ts, the kit's copy, unchanged).
// The app itself is plain static files a desktop browser loads offline —
// app/index.html and its ES modules, no library and no network request:
// eight multi-panel GTA-style layouts in a registry (v4 adds Vice Grid: a
// 2 x 2 grid of square photos over a caption band), four sunset/neon
// grades through a staged pipeline with a new duotone filter stage, a
// central store with one paint path and delegated controls, vendored
// Anton lettering with an outline-width control, per-panel photo crop,
// position presets and one-click PNG exports at 1080 x 1080, 1080 x 1350
// and 1920 x 1080. Its two sample photos (app/samples/) were made for
// make.fun with an image model and are free to use; everything else in
// the cover is the app's own drawing.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Run it twice and compare the two outputs: they must be byte-identical.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes
// the bytes; the others refuse an entry the scorer would refuse (more
// than 4 screenshots or one over 256 KiB; more than 993 files in app/ or
// 48 MiB of app files, in all, or a path under app/ over 1000 bytes:
// app/ counts beside /output's own 1000-entry cap, its screenshots/ and
// dossier.json).
const DOSSIER_OPTS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
  app_path_max_bytes: 1000,
};

// The studio's feature list, checked from the source itself before the
// handover: the layout registry must hold all eight layouts (Vice Grid
// included), the render pipeline must hold the duotone stage, and the
// page must carry the duotone toggle and the position presets.
const EXPECTED_LAYOUTS = [
  'vice-grid', 'slash-quad', 'hero-strips', 'banner-trio',
  'diagonal-trio', 'sunset-filmstrip', 'neon-diptych', 'sunset-strip',
];

/** Walks a directory tree, returning every file and directory under it. */
function collectPaths(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    found.push(path);
    if (entry.isDirectory()) found.push(...collectPaths(path));
  }
  return found;
}

/** Fails the run with one line per problem, before anything is copied. */
function fail(problems) {
  for (const problem of problems) console.error(`main.ts: ${problem}`);
  process.exit(1);
}

/**
 * Checks the studio's own features from its source text: every expected
 * layout registered in the scene registry, the duotone stage present in
 * the render pipeline, and the duotone toggle plus the position presets
 * wired into the page. A missing feature stops the run instead of
 * handing in an app that advertises what it does not have.
 */
function validateFeatures() {
  const problems = [];
  const scene = readFileSync(join(here, 'app', 'src', 'scene.js'), 'utf8');
  for (const id of EXPECTED_LAYOUTS) {
    if (!scene.includes(`defineLayout('${id}'`)) {
      problems.push(`scene.js does not register layout '${id}'`);
    }
  }
  const registered = (scene.match(/defineLayout\('/g) ?? []).length;
  if (registered !== EXPECTED_LAYOUTS.length) {
    problems.push(`scene.js registers ${registered} layouts, expected ${EXPECTED_LAYOUTS.length}`);
  }
  const render = readFileSync(join(here, 'app', 'src', 'render.js'), 'utf8');
  if (!render.includes('function stageDuotone')) {
    problems.push('render.js has no duotone stage');
  }
  if (!render.includes('stageDuotone,')) {
    problems.push('render.js does not run the duotone stage in its pipeline');
  }
  const page = readFileSync(join(here, 'app', 'index.html'), 'utf8');
  if (!page.includes('id="duotoneSwitch"')) {
    problems.push('index.html has no duotone toggle');
  }
  if (!page.includes('id="positionPicker"')) {
    problems.push('index.html has no position preset picker');
  }
  if (problems.length) fail(problems);
  console.log(`main.ts: features OK (${EXPECTED_LAYOUTS.length} layouts, duotone stage, position presets)`);
}

/**
 * Validates the entry against the gate caps before building: the app
 * file list (count, total bytes, longest path) and the screenshots
 * (count and each file's size). A failed check stops the run instead of
 * handing in an entry the scorer would refuse.
 */
function validateSubmission() {
  const problems = [];
  const appDir = join(here, 'app');
  const appEntries = collectPaths(appDir);
  let appBytes = 0;
  let longestPath = 0;
  for (const path of appEntries) {
    const stats = statSync(path);
    if (stats.isFile()) appBytes += stats.size;
    longestPath = Math.max(longestPath, Buffer.byteLength(path.slice(appDir.length + 1), 'utf8'));
  }
  if (appEntries.length > DOSSIER_OPTS.app_max_files) {
    problems.push(`app/ has ${appEntries.length} files/dirs, over the ${DOSSIER_OPTS.app_max_files} cap`);
  }
  if (appBytes > DOSSIER_OPTS.app_max_bytes) {
    problems.push(`app/ is ${appBytes} bytes, over the ${DOSSIER_OPTS.app_max_bytes} cap`);
  }
  if (longestPath > DOSSIER_OPTS.app_path_max_bytes) {
    problems.push(`an app/ path is ${longestPath} bytes, over the ${DOSSIER_OPTS.app_path_max_bytes} cap`);
  }
  const shotDir = join(here, 'screenshots');
  if (!existsSync(shotDir)) {
    problems.push('screenshots/ is missing');
  } else {
    const shots = readdirSync(shotDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'));
    if (shots.length < 3 || shots.length > DOSSIER_OPTS.screenshots.max) {
      problems.push(`screenshots/ holds ${shots.length} images, need 3 to ${DOSSIER_OPTS.screenshots.max}`);
    }
    for (const shot of shots) {
      const size = statSync(join(shotDir, shot.name)).size;
      if (size > DOSSIER_OPTS.screenshots.max_bytes) {
        problems.push(`screenshots/${shot.name} is ${size} bytes, over the ${DOSSIER_OPTS.screenshots.max_bytes} cap`);
      }
    }
  }
  if (problems.length) fail(problems);
  console.log(`main.ts: app/ OK (${appEntries.length} entries, ${appBytes} bytes), screenshots OK`);
}

validateFeatures();
validateSubmission();

mkdirSync(out, { recursive: true });
cpSync(join(here, 'app'), join(out, 'app'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, DOSSIER_OPTS),
);

// The dossier itself has a cap too: refuse to hand in one the scorer
// would refuse, rather than leaving a too-big file in /output.
const dossierBytes = statSync(join(out, 'dossier.json')).size;
if (dossierBytes > 1572864) {
  fail([`dossier.json is ${dossierBytes} bytes, over the 1572864 cap`]);
}
console.log(`main.ts: wrote ${out} (dossier.json ${dossierBytes} bytes)`);
