/** Inspect every frame of an aligned candidate before it can become a preview. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const reportFile=process.argv[2]&&resolve(process.argv[2]);
const inside=p=>{const r=relative(root,p);return !isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep);};
if(!reportFile||!inside(reportFile)||!existsSync(reportFile))throw new Error('Usage: node tools/dsh/inspect-transparent-video.mjs <alignment-report.json>');
const report=JSON.parse(readFileSync(reportFile,'utf8'));
const input=resolve(report.candidate||'');
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
if(!inside(input)||!existsSync(input)||digest(input)!==report.candidateSha256)throw new Error('Aligned candidate does not match its report');
if(report.width!==640||report.height!==360||!Number.isSafeInteger(report.frames)||report.frames<1)throw new Error('Unexpected candidate dimensions or frame count');
const ffmpeg=join(root,'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
const decoder=spawn(ffmpeg,['-v','error','-nostdin','-c:v','libvpx-vp9','-i',input,'-f','rawvideo','-pix_fmt','rgba','-']);
let error='';decoder.stderr.on('data',chunk=>{error+=chunk.toString();});
const done=new Promise((ok,fail)=>{decoder.once('error',fail);decoder.once('close',ok);});
done.catch(()=>{});
const width=640,height=360,pixels=width*height,frameBytes=pixels*4;
const mask=new Uint8Array(pixels),seen=new Uint8Array(pixels),queue=new Int32Array(pixels);
let pending=Buffer.alloc(0),first=null,last=null,previous=null;
const frames=[];
function meanVisibleDifference(a,b){
  let total=0,count=0;
  for(let p=0;p<frameBytes;p+=4){
    if(a[p+3]<64&&b[p+3]<64)continue;
    count++;for(let c=0;c<4;c++)total+=Math.abs(a[p+c]-b[p+c]);
  }
  return count?total/(count*4):0;
}
function inspect(frame){
  mask.fill(0);seen.fill(0);
  let minX=width,minY=height,maxX=-1,maxY=-1,visible=0,edgePixels=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;
    if(frame[i*4+3]<64)continue;
    mask[i]=1;visible++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    if(x<3||x>=width-3||y<3||y>=height-3)edgePixels++;
  }
  const components=[];
  for(let i=0;i<pixels;i++){
    if(!mask[i]||seen[i])continue;
    let start=0,end=0;queue[end++]=i;seen[i]=1;
    while(start<end){
      const p=queue[start++],x=p%width;
      const add=q=>{if(mask[q]&&!seen[q]){seen[q]=1;queue[end++]=q;}};
      if(x>0)add(p-1);if(x<width-1)add(p+1);if(p>=width)add(p-width);if(p<pixels-width)add(p+width);
    }
    if(end>=8)components.push(end);
  }
  components.sort((a,b)=>b-a);
  const adjacentDifference=previous?meanVisibleDifference(frame,previous):null;
  const firstDifference=first?meanVisibleDifference(frame,first):0;
  return {index:frames.length,visiblePixels:visible,bounds:maxX<0?null:{minX,minY,maxX,maxY},edgePixels,largestComponent:components[0]||0,largestDetachedComponent:components[1]||0,detachedComponents:Math.max(0,components.length-1),adjacentForegroundMeanRgbaDifference:adjacentDifference,firstForegroundMeanRgbaDifference:firstDifference};
}
try{
  for await(const chunk of decoder.stdout){
    pending=pending.length?Buffer.concat([pending,chunk]):chunk;
    while(pending.length>=frameBytes){
      const frame=pending.subarray(0,frameBytes);pending=pending.subarray(frameBytes);
      if(!first)first=Buffer.from(frame);
      frames.push(inspect(frame));last=Buffer.from(frame);previous=last;
    }
  }
  if(await done!==0)throw new Error(error||'Could not decode candidate');
  if(pending.length||frames.length!==report.frames)throw new Error('Candidate frame count does not match its report');
  if(frames.some(frame=>frame.visiblePixels<5000))throw new Error('One or more frames have no usable foreground');
  const folder=dirname(reportFile),contact=join(folder,'transparent-contact-sheet.png');
  const filter='[0:v]fps=1,scale=320:180[fg];color=c=0xd5d5d5:s=320x180:r=1[bg];[bg][fg]overlay=shortest=1,tile=5x2:padding=5:margin=5:color=white[out]';
  const shot=spawnSync(ffmpeg,['-v','error','-y','-c:v','libvpx-vp9','-i',input,'-filter_complex',filter,'-map','[out]','-frames:v','1',contact],{encoding:'utf8'});
  if(shot.error||shot.status!==0)throw shot.error||new Error(shot.stderr);
  const result={candidate:input,candidateSha256:report.candidateSha256,frames:frames.length,width,height,
    framesTouchingEdge:frames.filter(f=>f.edgePixels>0).length,
    maxEdgePixels:Math.max(...frames.map(f=>f.edgePixels)),
    maxDetachedComponent:Math.max(...frames.map(f=>f.largestDetachedComponent)),
    maxAdjacentForegroundMeanRgbaDifference:Math.max(0,...frames.slice(1).map(f=>f.adjacentForegroundMeanRgbaDifference)),
    identicalAdjacentFrames:frames.slice(1).filter(f=>f.adjacentForegroundMeanRgbaDifference===0).length,
    firstLastForegroundMeanRgbaDifference:meanVisibleDifference(first,last),
    closestFirstFrameInSecondHalf:frames.slice(Math.floor(frames.length/2)).reduce((best,frame)=>frame.firstForegroundMeanRgbaDifference<best.firstForegroundMeanRgbaDifference?frame:best),
    contactSheet:contact,details:frames,
    note:'These measurements flag possible cropping, detached marks and loop changes. They do not determine whether motion, face, hands, umbrella or edges look correct; review visually.'};
  writeFileSync(join(folder,'transparent-inspection.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({...result,details:undefined}));
}catch(e){decoder.kill();throw e;}
