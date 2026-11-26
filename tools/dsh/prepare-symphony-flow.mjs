/** Key and encode a Flow download without changing the source animation frames. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [action, flow, ...options] = process.argv.slice(2);
const key = options[0]?.startsWith('--') ? 'DD0DA7' : options.shift() ?? 'DD0DA7';
const [framing, ...extra] = options;
const flowPage = /^https:\/\/flow\.google\.com\/(?:u\/\d+\/)?project\/[\da-f-]{36}\/edit\/[\da-f-]{36}$/i;
if (!/^[a-z][a-z0-9-]*$/.test(action ?? '') || !flowPage.test(flow ?? '') || !/^[\da-f]{6}$/i.test(key)
    || (framing && !['--reframe', '--reframe-tall', '--full-frame'].includes(framing)) || extra.length) {
  throw new Error('Usage: node tools/dsh/prepare-symphony-flow.mjs <action-folder> <Flow video edit URL> [RRGGBB matte color] [--reframe|--reframe-tall|--full-frame]');
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(root, 'tools/dsh');
const base = join(root, 'assets/video-production/symphony-2020/v2');
const folder = join(base, action);
const source = join(folder, 'source.mp4');
const keyed = join(folder, 'desktop-keyed.webm');
const candidate = join(folder, 'desktop-flow.webm');
const ffmpeg = join(root, 'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase();

const progress = execFileSync(ffmpeg, ['-hide_banner','-nostats','-v','info','-progress','pipe:1',
  '-i',source,'-an','-map','0:v:0','-fps_mode','passthrough','-f','null','-'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
const count = [...progress.matchAll(/^frame=(\d+)$/gm)].at(-1);
if (!count || !Number(count[1])) throw new Error('The Flow download has no decodable frames');
const frames = Number(count[1]);

const { chromaFilter } = JSON.parse(readFileSync(join(base, 'wave/desktop-report.json'), 'utf8'));
const [red, green, blue] = key.match(/../g).map(channel => parseInt(channel, 16));
let keyFilter = chromaFilter.replace('0xDD0DA7', `0x${key}`).replaceAll('*221/255', `*${red}/255`)
  .replaceAll('*13/255', `*${green}/255`).replaceAll('*167/255', `*${blue}/255`);
const reframed = framing === '--reframe' || framing === '--reframe-tall';
if (reframed) {
  // Leave clearance for the shoes and props while keeping the desktop footline.
  keyFilter = keyFilter.replace('scale=640:360:flags=lanczos',
    `scale=580:326:flags=lanczos,pad=640:360:30:4:color=0x${key},setsar=1`);
}
if (framing === '--reframe-tall') keyFilter = keyFilter.replace('between(Y,40,309)', 'between(Y,18,309)');
if (framing === '--full-frame') {
  // Stage props can enter outside the standing figure's usual cleanup region.
  const standingRegion = 'between(X,150,490)*between(Y,40,309)*';
  if (!keyFilter.includes(standingRegion)) throw new Error('The standing-region matte template has changed');
  keyFilter = keyFilter.replace(standingRegion, '');
}
execFileSync(ffmpeg, ['-v','error','-nostdin','-filter_threads','2','-i',source,'-map','0:v:0',
  '-map_metadata','0','-vf',keyFilter,'-an','-c:v','libvpx-vp9','-lossless','1','-auto-alt-ref','0',
  '-fps_mode','passthrough','-row-mt','1','-threads','4','-cpu-used','4','-n',keyed], { stdio: 'inherit' });
execFileSync(process.execPath, [join(script, 'refine-symphony-matte.mjs'), keyed, candidate, String(frames)],
  { stdio: 'inherit' });

const report = { source, sourceSha256: hash(source), flow, candidate, candidateSha256: hash(candidate),
  width: 640, height: 360, frames, fps: 24, keyColor: key, reframed, framing,
  frameProcessing: 'Per-frame chroma key and matte refinement' };
const reportPath = join(folder, 'desktop-flow-report.json');
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
execFileSync(process.execPath, [join(script, 'inspect-transparent-video.mjs'), reportPath], { stdio: 'inherit' });
