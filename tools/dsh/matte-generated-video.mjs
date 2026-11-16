/** Make an inspectable VP9-alpha candidate. Never writes into the running pet pack. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const reportFile = process.argv[2] && resolve(process.argv[2]);
if (!reportFile || !existsSync(reportFile)) throw new Error('Usage: node tools/dsh/matte-generated-video.mjs <inspection.json>');
const inProject = path => { const r = relative(root, path); return !isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep); };
if (!inProject(reportFile)) throw new Error('Inspection and output must stay inside the Miku project');
const report = JSON.parse(readFileSync(reportFile, 'utf8'));
const input = resolve(report.input || '');
if (!inProject(input) || !existsSync(input)) throw new Error('Sample input is missing or outside this project');
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
if (!report.inputSha256 || sha(input) !== report.inputSha256) throw new Error('Input changed after inspection; inspect it again first');
if (!report.decodedCompletely || !Array.isArray(report.frames) || report.frames.length < 2 || report.frames.some(f => f.magentaBorderFraction < .9)) {
  throw new Error('Border is not consistently magenta: review the sample before choosing a key color');
}
const match = report.ffmpegInfo.match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
if (!match || Math.abs(+match[1] / +match[2] - 16 / 9) > .005) throw new Error('Expected a 16:9 video');
const ffmpeg = join(root, 'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
const folder = dirname(reportFile), target = join(folder, 'transparent-candidate.webm');
const run = (args, maxBuffer = 8 * 1024 * 1024) => {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', ...args], { maxBuffer });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return r;
};
run(['-v', 'error', '-y', '-i', input, '-map', '0:v:0', '-an', '-vf', 'colorkey=0xFF00FF:0.18:0.06,scale=640:360:flags=lanczos,setsar=1,format=yuva420p', '-c:v', 'libvpx-vp9', '-lossless', '1', '-auto-alt-ref', '0', '-row-mt', '1', '-threads', '4', '-deadline', 'good', '-cpu-used', '4', target]);
const first = run(['-v', 'error', '-c:v', 'libvpx-vp9', '-i', target, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']).stdout;
if (first.length !== 640 * 360 * 4) throw new Error('Candidate first-frame decode has an unexpected size');
let transparent = 0, opaque = 0;
for (let p = 3; p < first.length; p += 4) { if (first[p] < 5) transparent++; if (first[p] > 250) opaque++; }
if (transparent < 640 * 360 * .2 || opaque < 640 * 360 * .01) throw new Error('Candidate alpha coverage is implausible; inspect the output before use');
const complete = run(['-v', 'error', '-c:v', 'libvpx-vp9', '-i', target, '-f', 'null', '-', '-progress', 'pipe:1']).stdout.toString();
const frames = Number([...complete.matchAll(/^frame=(\d+)/gm)].at(-1)?.[1]);
if (!frames) throw new Error('Candidate did not fully decode');
const sourceFrames = Number([...report.ffmpegInfo.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]);
if (!sourceFrames || frames !== sourceFrames) throw new Error(`Candidate frame count ${frames} does not match source ${sourceFrames || 'unknown'}`);
run(['-v', 'error', '-y', '-c:v', 'libvpx-vp9', '-i', target, '-frames:v', '1', join(folder, 'transparent-first.png')]);
const out = { source: input, sourceSha256: report.inputSha256, candidate: target, candidateSha256: sha(target), width: 640, height: 360, sourceFrames, frames, bytes: statSync(target).size, transparentPixelsFirst: transparent, opaquePixelsFirst: opaque, note: 'Candidate only. Check edge quality, original character, watermark, timing and loop in a real window before any active-pack replacement.' };
writeFileSync(join(folder, 'matte-report.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
