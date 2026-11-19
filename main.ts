// Neon Sunset — the make.fun gta6-cover-art-01 entry program (Node 22, standard
// library only). It hands the app in: it copies this directory's app/ and
// screenshots/ to /output and writes /output/dossier.json, the summary the
// judge reads, with the vendored make.fun library (vendor/makefun-app.ts, the
// kit's copy, unchanged). The app itself is plain static files a desktop
// browser loads offline — app/index.html and its ES modules, no library and no
// network request: six multi-panel GTA-style layouts, four sunset/neon
// grades, vendored Anton lettering, per-panel photo crop and position, and
// one-click PNG exports at 1080 x 1080, 1080 x 1350 and 1920 x 1080. V2 adds
// the Neon Diptych layout — two tall angled panels over a caption band with
// a neon divider — and re-shoots all four screenshots in the v2 session.
// Its two sample photos (app/samples/) were made for make.fun with an image
// model and are free to use; everything else in the cover is the app's own
// drawing.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Run it twice and compare the two outputs: they must be byte-identical.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'app'), join(out, 'app'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the
// bytes; the others refuse an entry the scorer would refuse (more than 4
// screenshots or one over 256 KiB; more than 993 files in app/ or 48 MiB of
// app files, in all, or a path under app/ over 1000 bytes: app/ counts beside
// /output's own 1000-entry cap, its screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    app_max_files: 993,
    app_max_bytes: 50331648,
    app_path_max_bytes: 1000,
  }),
);
