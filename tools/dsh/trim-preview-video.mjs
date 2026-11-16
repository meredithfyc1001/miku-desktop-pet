/** Make a shorter candidate at a visually reviewed frame, retaining its source. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const reportFile=process.argv[2]&&resolve(process.argv[2]),frames=Number(process.argv[3]);
const inside=p=>{const r=relative(root,p);return !isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep);};
if(!reportFile||!inside(reportFile)||!existsSync(reportFile)||!Number.isSafeInteger(frames)||frames<2)throw new Error('Usage: node tools/dsh/trim-preview-video.mjs <alignment-report.json> <number-of-frames>');
const report=JSON.parse(readFileSync(reportFile,'utf8'));
const input=resolve(report.candidate||'');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
if(!inside(input)||!existsSync(input)||hash(input)!==report.candidateSha256)throw new Error('Candidate does not match its report');
if(report.width!==640||report.height!==360||frames>=report.frames)throw new Error('Frame limit or dimensions are invalid');
const ffmpeg=join(root,'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
const folder=dirname(reportFile),target=join(folder,'trimmed-candidate.webm');
if(existsSync(target))throw new Error('A trimmed candidate already exists');
const run=args=>{const p=spawnSync(ffmpeg,['-hide_banner','-nostdin',...args],{maxBuffer:8*1024*1024});if(p.error)throw p.error;if(p.status!==0)throw new Error(p.stderr.toString());return p;};
run(['-v','error','-c:v','libvpx-vp9','-i',input,'-map','0:v:0','-map_metadata','0','-an','-vf',`trim=end_frame=${frames},setpts=PTS-STARTPTS,setsar=1`,'-c:v','libvpx-vp9','-lossless','1','-auto-alt-ref','0','-row-mt','1','-threads','4','-deadline','good','-cpu-used','4',target]);
const progress=run(['-v','error','-c:v','libvpx-vp9','-i',target,'-f','null','-','-progress','pipe:1']).stdout.toString();
const actual=Number([...progress.matchAll(/^frame=(\d+)/gm)].at(-1)?.[1]);
if(actual!==frames)throw new Error(`Trimmed frame count ${actual} differs from requested ${frames}`);
const result={...report,source:input,sourceSha256:report.candidateSha256,candidate:target,candidateSha256:hash(target),frames,originalFrames:report.frames,bytes:statSync(target).size,note:'Shortened candidate only. The complete source remains available; inspect the chosen ending and playback visually.'};
writeFileSync(join(folder,'trimmed-alignment-report.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
