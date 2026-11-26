/** Recover clipped silhouettes from the same Flow frame, or remove the keyed floor under the winding box. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encode} from './polish-symphony-edges.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const ffmpeg=join(root,'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
const base=join(root,'assets/video-production/symphony-2020/v2');
const [input,output,mode,actionDirectory]=process.argv.slice(2);
const regions={top:[144,4,352,42],left:[64,32,92,280],bottom:[144,302,352,32],floor:[180,245,280,70]};
if(!input||!output||!Object.hasOwn(regions,mode))throw Error('Usage: node tools/dsh/recover-symphony-margins.mjs original.webm destination.webm top|left|bottom|floor [production-action-folder]');
const source=resolve(input),folder=actionDirectory?resolve(actionDirectory):dirname(source),video=join(folder,'source.mp4');
const production=JSON.parse(readFileSync(join(folder,'desktop-flow-report.json')));
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
if(digest(video)!==production.sourceSha256 || digest(source)!==production.candidateSha256)throw Error('Flow input or reference release hash differs');
const [rx,ry,w,h]=regions[mode], frames=production.frames;
const layout=production.reframed ? 'scale=580:326:flags=lanczos,pad=640:360:30:4:color=0x'+production.keyColor+',setsar=1' : 'scale=640:360:flags=lanczos';
const crop='crop='+[w,h,rx,ry].join(':');
const cut=mode==='floor';
const bytes=w*h*(cut?3:2.5);
let filter=layout+','+crop;
if(!cut) {
  const {chromaFilter}=JSON.parse(readFileSync(join(base,'wave/desktop-report.json')));
  const rgb=production.keyColor.match(/../g).map(c=>parseInt(c,16));
  filter=chromaFilter.replace('scale=640:360:flags=lanczos',layout+','+crop)
    .replace('0xDD0DA7:', '0x'+production.keyColor+':').replaceAll('*221/255','*'+rgb[0]+'/255')
    .replaceAll('*13/255','*'+rgb[1]+'/255').replaceAll('*167/255','*'+rgb[2]+'/255')
    .replace('between(X,150,490)*between(Y,40,309)*','');
}
const strip=execFileSync(ffmpeg,['-v','error','-nostdin','-threads','2','-filter_threads','2','-i',video,'-map','0:v:0',
  '-vf',filter,'-an','-fps_mode','passthrough','-pix_fmt',cut?'rgb24':'yuva420p','-f','rawvideo','-'],{maxBuffer:Math.ceil(bytes*(frames+1))});
if(strip.length!==bytes*frames)throw Error('Flow strip frame count mismatch');
const S=640*360, C=S/4, A=S+2*C;
const P=w*h,Q=P/4,O=P+2*Q;
const restoredPerFrame=[],modifiedPerFrame=[];
const a=new Uint8Array(P),seen=new Uint8Array(P),queue=new Int32Array(P);
const global=i=>(ry+Math.floor(i/w))*640+rx+i%w;
const outside=(x,y)=>mode==='top'?y<40:mode==='left'?x<150:y>309;
const boundary=(x,y)=>mode==='top'?y===40:mode==='left'?x===150:y===309;
function extend(frame,index) {
  const ref=strip.subarray(index*bytes,(index+1)*bytes),out=Buffer.from(frame);
  seen.fill(0); a.fill(0);
  let head=0,tail=0,count=0,changed=0;
  for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++) {
    const i=y*w+x,p=O+i,initial=ref[p];
    if(initial<16)continue;
    const cross=ref[p-1]+ref[p+1]+ref[p-w]+ref[p+w];
    const diagonals=ref[p-1-w]+ref[p+1-w]+ref[p-1+w]+ref[p+1+w];
    const blur=(4*initial+2*cross+diagonals)/16;
    a[i]=Math.round(Math.max(0,Math.min(255, ((initial+3*blur)/4-74)*255/166)));
    if(a[i]>=20 && boundary(rx+x,ry+y) && frame[A+global(i)]>=32){seen[i]=1;queue[tail++]=i;}
  }
  while(head<tail) {
    const i=queue[head++],x=rx+i%w,y=ry+Math.floor(i/w),j=global(i);
    if(outside(x,y)||boundary(x,y)){
      const isOutside=outside(x,y);
      if(isOutside && a[i]>=16)count++;
      if(a[i]!==frame[A+j])changed++;
      out[A+j]=Math.max(out[A+j],a[i]);
      if(isOutside) {
        // Target alpha and chroma only on the newly recovered part of the prop or hair.
        out[j]=ref[i];
        const k=(Math.floor(i/w)>>1)*(w>>1)+((i%w)>>1),g=(y>>1)*320+(x>>1);
        out[S+g]=ref[P+k];out[S+C+g]=ref[P+Q+k];
      }
    }
    for(const n of [i-1,i+1,i-w,i+w]){
      if(seen[n]||a[n]<2)continue;
      if(!outside(rx+n%w,ry+Math.floor(n/w)))continue;
      seen[n]=1;queue[tail++]=n;
    }
  }
  restoredPerFrame.push(count);modifiedPerFrame.push(changed);
  return out;
}
function cleanFloor(frame,index) {
  const ref=strip.subarray(index*bytes,(index+1)*bytes),out=Buffer.from(frame);
  let removed=0,changed=0;
  for(let i=0;i<P;i++) {
    const j=global(i),old=frame[A+j];if(!old)continue;
    const r=ref[3*i],g=ref[3*i+1],b=ref[3*i+2];
    // Gold and wood have a warmer green-than-blue channel ordering. Saturated
    // magenta, including its dark cast shadow, is present on the studio floor.
    const pink=Math.min((b-g)/Math.max(9,.16*r),(r-g)/Math.max(20,.39*r));
    const coverage=Math.min(1,Math.max(0,(1.14-pink)/.56));
    const next=Math.round(old*coverage);
    if(next!==old){out[A+j]=next;changed++;if(old>=32 && next<16)removed++;}
  }
  restoredPerFrame.push(removed);modifiedPerFrame.push(changed);return out;
}
const result=await encode(source,resolve(output),frames,cut?cleanFloor:extend);
writeFileSync(output+'.review.json',JSON.stringify({...result,flowSourceSha256:production.sourceSha256,flow:production.flow,
  sourceRegion:mode,affectedFrames:modifiedPerFrame.filter(n=>n>0).length,recoveredOrRemovedPixels:restoredPerFrame.reduce((a,b)=>a+b,0),
  maximumRecoveredOrRemovedPixels:Math.max(...restoredPerFrame),perFrame:restoredPerFrame},null,2)+'\n');
