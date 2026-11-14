// Token Radar v4 — entrypoint, Node 22+, standard library only.
//
// Run: node main.ts --input <snapshot.json|directory> [--output <dir>]
// Outside the grader MAKEFUN_OUTPUT_DIR stands in for /output.
//
// What it does: parse the sealed snapshot, score all 758 protocols with the
// radar-4 model from lib/model.ts (342 pre-token protocols by the model, 128
// traded tokens at market cap), refuse a board the gate would refuse, refuse
// a dashboard whose COMPARABLES copy has drifted from the model, then write
// board.json, data.js, the dashboard, the three screenshots and dossier.json.
// A bad run dies here, never at the scorer.
//
// Radar-4 versus radar-3: the category multiple is the median market-cap / TVL
// of the category's live tokens, shrunk toward the global median with a prior
// of 2 and clamped to [0.05, 5]; a lone live token's ratio is winsorized to
// the 90th percentile before shrinkage, so one outlier cannot price a whole
// category and a thin category's own evidence is no longer thrown away. Farm
// plans are built per launch from that launch's own numbers — TVL, implied
// value, rank, listing date, 7-day change, chains and category verbs — so no
// two plans read the same.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/** Caps the scorer itself enforces: the text cap shapes bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name <value>` or `--name=<value>` from the arguments, else the fallback. */
function flagValue(name: string, fallback: string): string {
  const position = process.argv.indexOf(`--${name}`);
  if (position >= 0 && position + 1 < process.argv.length) return process.argv[position + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** Copy a directory's regular files into `to`, skipping dot-names; return the names copied. */
function copyDirectory(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

function die(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

const inputPath = flagValue('input', '/input');
const snapshotPath = inputPath.endsWith('.json') ? inputPath : join(inputPath, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  die(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snap);
const gateIssue = boardIssue(board, snap);
if (gateIssue !== null) die(`the model wrote a board the gate refuses: ${gateIssue}`, 1);

// The dashboard's COMPARABLES table is a display copy of the category table
// the model computed; the build refuses a mismatch, so the table the judge
// reads can never drift from the numbers the model actually used.
const dashboardJs = readFileSync(join(repoRoot, 'dashboard', 'app.js'), 'utf8');
const tableMatch = dashboardJs.match(/const COMPARABLES = \[([\s\S]*?)\n\];/);
if (tableMatch === null) die('dashboard/app.js holds no COMPARABLES table to check', 1);
const shownRows = [...tableMatch[1].matchAll(/\["((?:[^"\\]|\\.)*)",\s*(\d+),\s*([0-9.]+),\s*([0-9.]+),/g)].map((m) => ({
  category: JSON.parse(`"${m[1]}"`),
  live_count: Number(m[2]),
  median_multiple: Number(m[3]),
  used_multiple: Number(m[4]),
}));
for (const computed of radar.comparables) {
  const shown = shownRows.find((t) => t.category === computed.category);
  if (shown === undefined) die(`COMPARABLES in app.js omits ${computed.category}`, 1);
  if (shown.live_count !== computed.live_count || shown.median_multiple !== computed.median_multiple || shown.used_multiple !== computed.used_multiple) {
    die(
      `COMPARABLES in app.js disagrees with the model on ${computed.category}: shown ${shown.live_count}/${shown.median_multiple}/${shown.used_multiple}, model ${computed.live_count}/${computed.median_multiple}/${computed.used_multiple}`,
      1,
    );
  }
}
if (shownRows.length !== radar.comparables.length) {
  die(`COMPARABLES in app.js has ${shownRows.length} rows, the model has ${radar.comparables.length}`, 1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

const dashboardCopied = copyDirectory(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
if (dashboardCopied.length === 0) die('dashboard/ holds no files to copy', 1);
const shotsCopied = copyDirectory(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
if (shotsCopied.length < 3) {
  die(`screenshots/ holds ${shotsCopied.length} image${shotsCopied.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`, 1);
}
for (const name of shotsCopied) {
  if (!IMAGE_NAME.test(name)) die(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
  const bytes = statSync(join(outDir, 'screenshots', name)).size;
  if (bytes > SCREENSHOT_CAPS.max_bytes) die(`screenshots/${name} is ${bytes} bytes, past the ${SCREENSHOT_CAPS.max_bytes} cap`, 1);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

const bestLaunch = radar.top_launch[0]!;
process.stdout.write(
  `token radar: ${snap.protocols.length} protocols, ${snap.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.launch_count} launch candidates, ${radar.token_count} traded tokens, ${radar.excluded_count} with no value anchor)\n` +
    `token radar: top launch ${bestLaunch.name} at ${bestLaunch.implied_value_usd.toLocaleString('en-US')} USD, total board value ${radar.total_board_value_usd.toLocaleString('en-US')} USD, global comparable multiple ${radar.global_median}\n` +
    `token radar: calibration on ${radar.calibration.token_rows} traded tokens: median absolute log error ${radar.calibration.median_abs_log_ratio}, ${(radar.calibration.within_2x * 100).toFixed(1)}% within 2x of the market\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dashboardCopied.length} files), ${join(outDir, 'screenshots')} (${shotsCopied.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
