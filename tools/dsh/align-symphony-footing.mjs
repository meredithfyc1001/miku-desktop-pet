/** Reframe undersized Symphony motions against the accepted front idle. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const v2 = join(root, 'assets/video-production/symphony-2020/v2');
const ffmpeg = join(root, 'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
const reportDir = join(root, '.local-work-diagnostics/wardrobe-review');
const reportPath = join(reportDir, 'second-footing.json');
const actions = ['yawn', 'flower', 'tiptoe', 'waltz', 'cushion', 'cube', 'harp', 'violin'];
const actionNames = ['困到打哈欠','捡起小白花','踮脚探头','两步小华尔兹','抱住音符枕','拧动小魔方','拨响小竖琴','小提琴独奏'];
const manifest = JSON.parse(readFileSync(join(v2, 'desktop-clips.json'), 'utf8'));
// The first six motions have the same opening pose and framing. The instrument clips have
// different heights. For those two, trim clear margins to make the scale exact on both axes.
const standing = {initial:[196,443,56,266],sourceRect:[0,0,640,360],size:[704,396],border:0,crop:[32,3]};
const harp = {initial:[196,449,60,277],sourceRect:[1,6,638,348],size:[682,372],border:16,crop:[40,16]};
const violin = {initial:[190,449,54,277],sourceRect:[7,5,625,350],size:[650,364],border:16,crop:[22,9]};
function videoFilter({sourceRect:[x,y,w,h],size:[sw,sh],border,crop:[cx,cy]}) {
  // Keep the approved matte. Resample premultiplied 16-bit color so clear pixels cannot darken hair tips.
  const chain=['format=gbrap16le','premultiply=planes=7:inplace=1'];
  if(w!==640||h!==360) chain.push(`crop=${w}:${h}:${x}:${y}:exact=1`);
  chain.push(`scale=${sw}:${sh}:flags=bicubic+accurate_rnd`);
  if(border) chain.push(`pad=iw+${border*2}:ih+${border*2}:${border}:${border}:color=black@0`);
  chain.push(`crop=640:360:${cx}:${cy}:exact=1`,'unpremultiply=planes=7:inplace=1','setsar=1','format=yuva420p');
  return chain.join(',');
}
const names = process.argv.slice(2);
for (const slug of names) assert.ok(actions.includes(slug), 'Unknown action: ' + slug);
mkdirSync(reportDir, {recursive: true});
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
const portable = p => relative(root, p).replaceAll('\\', '/');
function run(args) {
  const r = spawnSync(ffmpeg, ['-nostdin', '-hide_banner', ...args], {encoding: 'utf8', maxBuffer: 3000000});
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stderr;
}
function inspect(p, threshold) {
  const out = run(['-c:v','libvpx-vp9','-i',p,'-an','-vf','alphaextract,bbox=min_val='+threshold,'-f','null','NUL']);
  const frames = [...out.matchAll(/n:(\d+) pts:(\d+) pts_time:([\d.]+) x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/g)]
    .map(m => ({index:+m[1], pts:+m[2], time:+m[3], bounds:m.slice(4,8).map(Number)}));
  assert.ok(frames.length > 0, 'No visible alpha in '+p);
  return frames;
}
function measureBounds(frames) {
  return frames.reduce(([a,b,c,d],{bounds:[x0,x1,y0,y1]}) =>
    [Math.min(a,x0),Math.max(b,x1),Math.min(c,y0),Math.max(d,y1)], [640,-1,360,-1]);
}
const hashOfTimes = frames => createHash('sha256').update(JSON.stringify(frames.map(({index,pts,time})=>[index,pts,time]))).digest('hex');
// This transfer was calibrated against the approved two-feet-down pose, even after it left the idle menu.
const reference = resolve(v2,'../front-idle-matched/desktop.webm');
assert.equal(sha(reference),'785F6D296934B57F575E1782CFDA9F2847B15F7DE3A90DFAE8C438B3032B76F2');
const refs = inspect(reference,48);
const refBounds = refs[0].bounds;
const results=[];
for (const slug of names.length ? names : actions) {
  // Use the original polished transfer even after the new file becomes the active manifest entry.
  const name = actionNames[actions.indexOf(slug)];
  const row = manifest.find(row => row.name===name);
  const original=JSON.parse(readFileSync(join(v2,slug,'desktop-flow-report.json'),'utf8'));
  assert.equal(sha(join(v2,slug,'source.mp4')),original.sourceSha256);
  const source = join(v2,slug,'desktop-edge-polished.webm');
  const candidate=join(v2,slug,'desktop-footing-aligned.webm');
  const tmp=candidate+'.'+randomUUID()+'.writing.webm';
  const inputHash=sha(source);
  if(row?.file===slug+'/desktop-edge-polished.webm') assert.equal(inputHash,row.sha256);
  const before=inspect(source,48);
  const spec=slug==='harp'?harp:slug==='violin'?violin:standing;
  const [left,top,w,h]=spec.sourceRect, scale=spec.size[0]/w, [cx,cy]=spec.crop;
  assert.equal(spec.size[0]*h,spec.size[1]*w,'Scale must be uniform across both axes.');
  const translateX=spec.border-cx-left*scale, translateY=spec.border-cy-top*scale;
  const filter=videoFilter(spec);
  assert.deepEqual(before[0].bounds,spec.initial);
  assert.equal(before.length,original.frames);
  const beforeAll=measureBounds(inspect(source,1));
  assert.ok(beforeAll[0]>=left && beforeAll[1]<left+w && beforeAll[2]>=top && beforeAll[3]<top+h,
    'The scale would remove source pixels');
  try {
    run(['-v','error','-filter_threads','1','-c:v','libvpx-vp9','-i',source,'-map','0:v:0','-map_metadata','0','-an','-vf',filter,
      '-fps_mode','passthrough','-c:v','libvpx-vp9','-lossless','1','-auto-alt-ref','0','-threads','2','-row-mt','0',
      '-deadline','good','-cpu-used','5','-fflags','+bitexact','-n',tmp]);
    const after=inspect(tmp,48), allAlpha=inspect(tmp,1);
    assert.equal(hashOfTimes(after),hashOfTimes(before),'Presentation times changed');
    assert.equal(hashOfTimes(allAlpha),hashOfTimes(before),'A frame has no character');
    const [x0,x1,y0,y1]=measureBounds(allAlpha);
    assert.ok(x0>0 && x1<639 && y0>0 && y1<359,'Output touched the frame boundary');
    const first=after[0].bounds,last=after.at(-1).bounds;
    assert.ok(Math.abs(first[3]-refBounds[3])<=1 && Math.abs(last[3]-refBounds[3])<=2,'Check sole position');
    assert.ok(Math.abs((first[3]-first[2])-(refBounds[3]-refBounds[2]))<=1,'First-pose scale changed');
    const maxDrift=after.reduce((max,{bounds},i)=>Math.max(max,...bounds.map((n,k)=>
      Math.abs(n-(before[i].bounds[k]*scale+(k<2?translateX:translateY))))),0);
    assert.ok(maxDrift<=2,'A frame lost its original outline or prop');
    const outputHash=sha(tmp);
    if (existsSync(candidate)) {
      assert.equal(sha(candidate),outputHash,'Different earlier candidate. Check it before replacing it.');
      unlinkSync(tmp);
    } else { renameSync(tmp,candidate); }
    const result={name,slug,input:portable(source),inputHash,sourceFlow:original.flow,
      candidate:portable(candidate),candidateSha256:outputHash,bytes:statSync(candidate).size,frames:after.length,
      dimensions:[640,360],alphaThreshold:48,firstBefore:before[0].bounds,lastBefore:before.at(-1).bounds,
      firstAfter:first,lastAfter:last,visibleBoundsAcrossAllFramesAtAlpha2:[x0,x1,y0,y1],
      maxBoundsErrorPx:Math.round(maxDrift*100)/100,timelineSha256:hashOfTimes(after),
      frameTimesUnchanged:true,globalTransform:{scale,translateX,translateY},filter};
    if(slug==='cushion') result.wardrobe='宽袖仍在原片中，本次只调整整体摆位。';
    if(slug==='harp') result.wardrobe='白色短手套仍在原片中，本次只调整整体摆位。';
    results.push(result);
    console.log(result.name,outputHash,JSON.stringify(first),JSON.stringify(last),'max bounds residual px',result.maxBoundsErrorPx);
  } finally { if(existsSync(tmp)) unlinkSync(tmp); }
}
const completed = new Map();
if (existsSync(reportPath)) {
  for (const entry of JSON.parse(readFileSync(reportPath,'utf8')).actions) completed.set(entry.slug,entry);
}
for(const entry of results) completed.set(entry.slug,entry);
writeFileSync(reportPath,JSON.stringify({command:'node tools/dsh/align-symphony-footing.mjs',reference:portable(reference),
  referenceSha256:sha(reference),referenceBounds:refBounds,actions:actions.filter(s=>completed.has(s)).map(s=>completed.get(s))},null,2)+'\n');
