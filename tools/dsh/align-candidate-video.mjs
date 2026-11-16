/** Align a candidate to the existing idle silhouette without changing the source video. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const reportFile=process.argv[2]&&resolve(process.argv[2]);
const inside=p=>{const r=relative(root,p);return !isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep);};
if(!reportFile||!inside(reportFile)||!existsSync(reportFile))throw new Error('Usage: node tools/dsh/align-candidate-video.mjs <gradient-matte-report.json>');
const report=JSON.parse(readFileSync(reportFile,'utf8'));
const input=resolve(report.candidate||'');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
if(!inside(input)||!existsSync(input)||hash(input)!==report.candidateSha256)throw new Error('Candidate does not match its matte report');
if(report.width!==640||report.height!==360||report.outputFrames!==report.sourceFrames)throw new Error('Candidate size or frame count is unexpected');
const ffmpeg=join(root,'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
const reference=join(root,'integrations/dsh/pack/miku-animation/待机眨眼.png');
const run=(args,maxBuffer=8*1024*1024)=>{const p=spawnSync(ffmpeg,['-hide_banner','-nostdin',...args],{maxBuffer});if(p.error)throw p.error;if(p.status!==0)throw new Error(p.stderr.toString());return p;};
const rgba=(path,isWebm)=>run(['-v','error',...(isWebm?['-c:v','libvpx-vp9']:[]),'-i',path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','-']).stdout;
const largest=raw=>{
  const w=640,h=360,size=w*h,seen=new Uint8Array(size),queue=new Int32Array(size);let best=null;
  if(raw.length!==size*4)throw new Error('Expected a 640×360 RGBA frame');
  for(let origin=0;origin<size;origin++){
    if(seen[origin]||raw[origin*4+3]<32)continue;
    let head=0,tail=0,minX=w,minY=h,maxX=0,maxY=0;seen[origin]=1;queue[tail++]=origin;
    while(head<tail){
      const p=queue[head++],x=p%w,y=Math.floor(p/w);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      const add=q=>{if(!seen[q]&&raw[q*4+3]>=32){seen[q]=1;queue[tail++]=q;}};
      if(x>0)add(p-1);if(x<w-1)add(p+1);if(y>0)add(p-w);if(y<h-1)add(p+w);
    }
    if(!best||tail>best.pixels)best={pixels:tail,minX,minY,maxX,maxY};
  }
  if(!best||best.pixels<5000)throw new Error('Main connected silhouette was not found');
  return best;
};
const ref=largest(rgba(reference,false)), candidate=largest(rgba(input,true));
const rw=ref.maxX-ref.minX+1,rh=ref.maxY-ref.minY+1,cw=candidate.maxX-candidate.minX+1,ch=candidate.maxY-candidate.minY+1;
// Use a uniform scale; align the character centers and shoe baseline.
const scale=Math.min(rw/cw,rh/ch,1);
const outW=Math.max(2,Math.round(640*scale/2)*2),outH=Math.max(2,Math.round(360*scale/2)*2);
const sx=outW/640,sy=outH/360;
const left=Math.round((ref.minX+ref.maxX)/2-(candidate.minX+candidate.maxX)/2*sx);
const top=Math.round(ref.maxY-candidate.maxY*sy);
if(left<0||top<0||left+outW>640||top+outH>360)throw new Error('Calculated alignment would crop the candidate');
const folder=dirname(reportFile),target=join(folder,'aligned-candidate.webm');
const filter=`format=rgba,scale=${outW}:${outH}:flags=lanczos,pad=640:360:${left}:${top}:color=black@0,setsar=1,format=yuva420p`;
run(['-v','error','-y','-c:v','libvpx-vp9','-i',input,'-an','-vf',filter,'-c:v','libvpx-vp9','-lossless','1','-auto-alt-ref','0','-row-mt','1','-threads','4','-deadline','good','-cpu-used','4',target]);
const raw=rgba(target,true);let clear=0;for(let p=3;p<raw.length;p+=4)if(raw[p]<5)clear++;
if(clear<640*360*.2)throw new Error('Aligned candidate lost its transparent background');
const out=run(['-v','error','-c:v','libvpx-vp9','-i',target,'-f','null','-','-progress','pipe:1']).stdout.toString();
const frames=Number([...out.matchAll(/^frame=(\d+)/gm)].at(-1)?.[1]);
if(frames!==report.sourceFrames)throw new Error('Alignment changed the number of frames');
run(['-v','error','-y','-c:v','libvpx-vp9','-i',target,'-frames:v','1',join(folder,'aligned-first.png')]);
const final=largest(raw);
const result={source:input,sourceSha256:report.candidateSha256,reference,referenceSha256:hash(reference),candidate:target,candidateSha256:hash(target),width:640,height:360,referenceBounds:ref,originalBounds:candidate,alignedBounds:final,scaleX:sx,scaleY:sy,left,top,frames,bytes:statSync(target).size,note:'Candidate only. Original motion, source markings if present, and edge imperfections remain.'};
writeFileSync(join(folder,'alignment-report.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
