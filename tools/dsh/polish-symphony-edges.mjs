/** Remove trace key-color and hard diagonal pixels from an approved 640x360 Symphony WebM.
 * Work in the original YUVA planes so untouched colors and source timing survive lossless encoding.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ffmpeg = resolve(root, 'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
const width = 640, height = 360, pixels = width * height;
const chromaWidth = width / 2, chromaPixels = pixels / 4;
const alphaOffset = pixels + 2 * chromaPixels, frameBytes = alphaOffset + pixels;
const videoArgs = ['-hide_banner', '-v', 'error', '-nostdin', '-threads', '2', '-c:v', 'libvpx-vp9'];
const clampByte = value => Math.max(0, Math.min(255, Math.round(value)));
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
const neighbors = [];
for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
  const radius = dx * dx + dy * dy;
  if (radius > 0 && radius <= 10) neighbors.push({dx,dy,radius});
}
neighbors.sort((a,b)=>a.radius-b.radius);
const magenta = (u,v) => Math.min(2.409 * (v-128) + .392 * (u-128), 2.409 * (u-128) + .813 * (v-128));

export function polishFrame(frame) {
  const out = Buffer.from(frame);
  const alpha = frame.subarray(alphaOffset);
  let cornerPixels = 0, spillBlocks = 0, mintBlocks = 0, darkPixels = 0, spillBefore = 0, spillAfter = 0;
  let xmin = width, xmax = -1, ymin = height, ymax = -1, alphaMass = 0, removedMass = 0;
  for(let i = 0; i < pixels; i++) {
    const a = alpha[i];
    if (a === 0) continue;
    alphaMass += a;
    if (a < 24) continue;
    const x=i%width, y=Math.floor(i/width);
    xmin=Math.min(xmin,x); xmax=Math.max(xmax,x);
    ymin=Math.min(ymin,y); ymax=Math.max(ymax,y);
    if (x < 2 || x+2 >= width || y < 2 || y+2 >= height || a < 148) continue;
    const l=alpha[i-1],r=alpha[i+1],t=alpha[i-width],b=alpha[i+width];
    // Feather only high-coverage pixels on steep, solidly supported silhouette steps.
    // Protect thin spokes and tips that lack a pair of perpendicular inward neighbors.
    if(Math.min(l,r,t,b)>45 || Math.max(l,r)<180 || Math.max(t,b)<180) continue;
    const sideX=l>r ? -1 : 1, sideY=t>b ? -width : width;
    if(alpha[i+sideX+sideY]<205 || Math.max(alpha[i+2*sideX],alpha[i+2*sideY])<220) continue;
    const diagonal=alpha[i-width-1]+alpha[i-width+1]+alpha[i+width-1]+alpha[i+width+1];
    const mean=(4*a+2*(l+r+t+b)+diagonal)/16;
    const reduction=Math.min(26,Math.round((a-mean)*.33));
    if(reduction<5) continue;
    out[alphaOffset+i]=a-reduction;
    removedMass+=reduction;
    cornerPixels++;
  }
  for(let cy=Math.max(3, Math.floor(ymin/2)-1); cy<=Math.min(height/2-4,Math.ceil(ymax/2)+1); cy++) {
    for(let cx=Math.max(3, Math.floor(xmin/2)-1); cx<=Math.min(chromaWidth-4,Math.ceil(xmax/2)+1);cx++) {
      const c=cy*chromaWidth+cx, i=cy*2*width+2*cx;
      const indices=[i,i+1,i+width,i+width+1];
      const a0=alpha[i],a1=alpha[i+1],a2=alpha[i+width],a3=alpha[i+width+1];
      const lo=Math.min(a0,a1,a2,a3),hi=Math.max(a0,a1,a2,a3);
      if(hi<40 || lo>=220 || hi-lo<28)continue;
      const u=frame[pixels+c],v=frame[pixels+chromaPixels+c],pink=magenta(u,v);
      const mass=a0+a1+a2+a3;
      const lum=(frame[i]*a0+frame[i+1]*a1+frame[i+width]*a2+frame[i+width+1]*a3)/mass;
      let inner=null,best=Infinity;
      for(const n of neighbors) {
        const j=i+2*n.dx+2*width*n.dy;
        if(Math.min(alpha[j],alpha[j+1],alpha[j+width],alpha[j+width+1]) < 244)continue;
        const cc=c+n.dx+chromaWidth*n.dy;
        const innerY=(frame[j]+frame[j+1]+frame[j+width]+frame[j+width+1]) / 4;
        const score=n.radius + Math.abs(lum-innerY)/40;
        if (score < best) {
          inner={y:innerY,u:frame[pixels+cc],v:frame[pixels+chromaPixels+cc]};
          best=score;
        }
      }
      if(!inner)continue;
      const innerPink=magenta(inner.u,inner.v);
      // A previous spill correction can leave a grey or lilac band on turquoise hair.
      // Use only an adjacent opaque mint sample with matching luminance. Preserve gold and skin.
      const greenOverRed=(cb,cr)=>-2.409*(cr-128)-.392*(cb-128);
      const blueOverRed=(cb,cr)=>2.017*(cb-128)-1.596*(cr-128);
      const innerMint=greenOverRed(inner.u,inner.v),edgeMint=greenOverRed(u,v);
      const mintDeficit=innerMint-edgeMint;
      if(innerMint>22 && blueOverRed(inner.u,inner.v)>12 && edgeMint<.8*innerMint &&
          mintDeficit>9 && Math.abs(inner.y-lum)<42) {
        const weight=Math.min(.66,.28+mintDeficit/120)*Math.min(1,(255-lo)/96);
        out[pixels+c]=clampByte(u+(inner.u-u)*weight);
        out[pixels+chromaPixels+c]=clampByte(v+(inner.v-v)*weight);
        mintBlocks++;
      }
      if(pink>16 && innerPink<12 && pink-innerPink>12 && Math.abs(inner.y-lum)<60) {
        const weight=Math.min(.80,(pink-8)/45) * Math.min(1,(255-lo)/120);
        const u2=clampByte(u+(inner.u-u)*weight), v2=clampByte(v+(inner.v-v)*weight);
        out[pixels+c]=u2; out[pixels+chromaPixels+c]=v2;
        spillBefore+=Math.max(0,pink); spillAfter+=Math.max(0,magenta(u2,v2)); spillBlocks++;
      }
      // On light, continuous surfaces only: compensate a dark matte baked into very soft pixels.
      if(inner.y<110 || Math.abs(u-inner.u)+Math.abs(v-inner.v)>29 || Math.abs(lum-inner.y)>35)continue;
      for(const j of indices) {
        const a=alpha[j],y=frame[j];
        if(a<40||a>160||inner.y-y<32) continue;
        const premultiplied=16+(inner.y-16)*a/255;
        if(Math.abs(y-premultiplied)>11) continue;
        out[j]=clampByte(y+Math.min(24,(inner.y-y)*.35)); darkPixels++;
      }
    }
  }
  return {out,stats:{cornerPixels,spillBlocks,mintBlocks,darkPixels,spillBefore,spillAfter,alphaMass,removedMass,bounds:[xmin,ymin,xmax,ymax]}};
}

export function sampleFrames(source,frames) {
  const picks=[...new Set([0,.16,.32,.50,.67,.85,1].map(t=>Math.round(t*(frames-1))))];
  const select=picks.map(n=>'eq(n\\,'+n+')').join('+');
  const raw=execFileSync(ffmpeg,[...videoArgs,'-i',source,'-map','0:v:0','-vf','select='+select,
    '-an','-fps_mode','passthrough','-pix_fmt','yuva420p','-f','rawvideo','pipe:1'],{maxBuffer:(picks.length+1)*frameBytes});
  if(raw.length!==frameBytes*picks.length)throw Error('Unexpected number of sampled source frames: '+source);
  return picks.map((index,n)=>({index,frame:raw.subarray(n*frameBytes,(n+1)*frameBytes)}));
}

export function composite(frame, background) {
  const rgb=Buffer.alloc(pixels*3);
  for(let i=0;i<pixels;i++) {
    const x=i%width,y=Math.floor(i/width),c=(y>>1)*chromaWidth+(x>>1);
    const Y=1.164*(frame[i]-16),U=frame[pixels+c]-128,V=frame[pixels+chromaPixels+c]-128,a=frame[alphaOffset+i]/255;
    rgb[3*i]  =clampByte(background+(clampByte(Y+1.596*V)-background)*a);
    rgb[3*i+1]=clampByte(background+(clampByte(Y-.392*U-.813*V)-background)*a);
    rgb[3*i+2]=clampByte(background+(clampByte(Y+2.017*U)-background)*a);
  }
  return rgb;
}
export async function encode(source,destination,frames,repair=null) {
  if(existsSync(destination))throw Error('Output already exists: '+destination);
  mkdirSync(dirname(destination),{recursive:true});
  const temporary=destination+'.writing.webm';
  const decoder=spawn(ffmpeg,[...videoArgs,'-i',source,'-map','0:v:0','-an','-fps_mode','passthrough','-f','rawvideo','-pix_fmt','yuva420p','-'],{stdio:['ignore','pipe','inherit']});
  const encoder=spawn(ffmpeg,['-v','error','-nostdin','-f','rawvideo','-pix_fmt','yuva420p','-s','640x360','-framerate','24','-i','-',
    '-i',source,'-map','0:v:0','-map_metadata','1','-an','-c:v','libvpx-vp9','-lossless','1','-auto-alt-ref','0','-row-mt','1',
    '-threads','2','-cpu-used','6','-n',temporary],{stdio:['pipe','ignore','inherit']});
  const dc=once(decoder,'close'),ec=once(encoder,'close');
  dc.catch(()=>{});ec.catch(()=>{});
  let remaining=Buffer.alloc(0),count=0;
  const stats={cornerPixels:0,spillBlocks:0,mintBlocks:0,darkPixels:0,spillBefore:0,spillAfter:0,alphaMass:0,removedMass:0};
  const hash=createHash('sha256');
  try {
    for await(const chunk of decoder.stdout) {
      remaining=remaining.length ? Buffer.concat([remaining,chunk]) : chunk;
      while(remaining.length>=frameBytes) {
        const frame=remaining.subarray(0,frameBytes); remaining=remaining.subarray(frameBytes);
        const {out,stats:measured}=polishFrame(repair ? repair(frame,count) : frame);
        for(const key of Object.keys(stats))stats[key]+=measured[key];
        hash.update(out);
        if(!encoder.stdin.write(out))await once(encoder.stdin,'drain');
        count++;
      }
    }
    encoder.stdin.end();
    if((await dc)[0]!==0 || (await ec)[0]!==0 || count!==frames || remaining.length)throw Error('Frame count or transcode failure');
    const expected = hash.digest('hex');
    const decoded=spawnSync(ffmpeg,[...videoArgs,'-i',temporary,'-map','0:v:0','-an','-pix_fmt','yuva420p','-fps_mode','passthrough','-f','hash','-hash','sha256','-'],{encoding:'utf8'});
    if(decoded.status!==0 || !decoded.stdout.toLowerCase().includes(expected))throw Error('Lossless frame verification failed: '+temporary);
    renameSync(temporary,destination);
    return {sourceSha256:digest(source),sha256:digest(destination),frames:count,decodedSha256:expected,...stats};
  } catch(e) {
    decoder.kill(); encoder.kill(); throw e;
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [source,destination,count,...more]=process.argv.slice(2);
  if(!source||!destination||more.length||!Number.isSafeInteger(+count)||+count<1)throw Error('Usage: node tools/dsh/polish-symphony-edges.mjs input.webm output.webm frames');
  const report=await encode(resolve(source),resolve(destination),+count);
  writeFileSync(destination+'.review.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
