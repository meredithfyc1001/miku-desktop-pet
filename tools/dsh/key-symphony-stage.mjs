/** Full-frame chroma matte for the Symphony music box shot on a magenta studio floor. */
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [action, flow, matteOption, ...extra] = process.argv.slice(2);
const roseStudio = matteOption === '--rose-studio';
if (!/^[a-z][a-z0-9-]*$/.test(action ?? '') || !/^https:\/\/flow\.google\.com\/(?:u\/\d+\/)?project\/[\da-f-]{36}\/edit\/[\da-f-]{36}$/i.test(flow ?? '') || (matteOption && !roseStudio) || extra.length) {
  throw new Error('Usage: node tools/dsh/key-symphony-stage.mjs <action-folder> <Flow edit URL> [--rose-studio]');
}
const folder = join(root, 'assets/video-production/symphony-2020/v2', action);
const ffmpeg = join(root, 'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
const source = join(folder, 'source.mp4');
const candidate = join(folder, 'desktop-flow.webm');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase();
const width = 1280, height = 720, pixels = width * height, frameBytes = pixels * 3;
const fps = 24;
const args = ['-v','error','-nostdin'];
const info = spawnSync(ffmpeg, ['-hide_banner','-nostats','-nostdin','-i',source,'-map','0:v:0','-an','-fps_mode','passthrough','-progress','pipe:1','-f','null','-'], { encoding:'utf8' });
if (info.error || info.status !== 0) throw info.error ?? new Error(info.stderr);
const expected = Number([...info.stdout.matchAll(/^frame=(\d+)$/gm)].at(-1)?.[1]);
const track = info.stderr.split('\n').find(line => line.includes('Video:')) ?? '';
if (!expected || !/\b1280x720\b/.test(track) || !/\b24 fps\b/.test(track)) {
  throw new Error('Expected a 1280×720, 24 fps studio shot');
}
const decoder = spawn(ffmpeg, [...args, '-i',source,'-map','0:v:0','-an','-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24','-']);
const encoder = spawn(ffmpeg, [...args,'-n','-f','rawvideo','-pix_fmt','rgba','-s','640x360','-r',String(fps),'-i','-','-i',source,'-map','0:v:0','-map_metadata','1','-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-lossless','1','-auto-alt-ref','0','-row-mt','1','-threads','4','-cpu-used','4',candidate]);
const ended = child => new Promise((ok, fail) => { child.once('error',fail); child.once('close',code => code === 0 ? ok() : fail(new Error('ffmpeg exited ' + code))); });
const decodeDone = ended(decoder), encodeDone = ended(encoder);
decodeDone.catch(()=>{}); encodeDone.catch(()=>{});
decoder.stderr.pipe(process.stderr); encoder.stderr.pipe(process.stderr);
const clamp = number => Math.min(1, Math.max(0, number));
const byte = number => Math.min(255, Math.max(0, Math.round(number)));
const background = new Float32Array(height * 3);
const output = () => Buffer.alloc((width / 2) * (height / 2) * 4);

function matte(rgb) {
  // Estimate the plate on each scanline from genuinely pink border pixels only.
  // This excludes the wooden box as it slides through the border.
  for (let y = 0; y < height; y++) {
    let count = 0, sumR = 0, sumG = 0, sumB = 0;
    for (let dx = 1; dx < 35; dx += 3) {
      for (const x of [dx, width - dx - 1]) {
        const i = (y * width + x) * 3, r = rgb[i], g = rgb[i+1], b = rgb[i+2];
        if (b - g < (roseStudio ? .14 : .24) * r || r - g < (roseStudio ? .30 : .43) * r || r < 85) continue;
        count++; sumR += r; sumG += g; sumB += b;
      }
    }
    const i = y * 3;
    background[i] = count ? sumR/count : 190;
    background[i+1] = count ? sumG/count : 62;
    background[i+2] = count ? sumB/count : 135;
  }

  // Composite four source pixels in premultiplied space for each desktop pixel.
  // The hue test is independent of luminance so it also keys the box's cast shadow.
  const result = output();
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      let alpha = 0, red = 0, green = 0, blue = 0;
      for (let dy = 0; dy < 2; dy++) {
        const j = (y+dy)*3, rBg = background[j], gBg = background[j+1], bBg = background[j+2];
        for (let dx = 0; dx < 2; dx++) {
          const p = ((y+dy)*width+x+dx)*3;
          const r=rgb[p], g=rgb[p+1], b=rgb[p+2];
          // The deepest contact shadow under this low box is almost black.
          // Dusty reflections on its upper turntable are dark solid wood.
          const floor = clamp((y/height-.89)/.018);
          // The pale rose plate has less blue separation than saturated magenta.
          const normalBlue = roseStudio ? Math.max(4, .13*r) : Math.max(15, .21*r+.05*Math.max(0,r-82));
          const pinkBlue = (b-g) / ((1-floor)*normalBlue+floor*Math.max(2,.055*r));
          const pinkRed = (r-g) / (roseStudio ? Math.max(5, .30*r) : Math.max(18, .48*r));
          const pink = Math.min(pinkBlue, pinkRed);
          let shadedObject = clamp((144-r)/34)*(1-floor);
          if (roseStudio && r < 197 && y < height*.87) {
            // Reflected pink on the disk can look like the floor. Its dark solid rim
            // and wooden plinth directly underneath distinguish it from empty space.
            for (const offset of [7, 15, 23]) {
              const below = p + offset*width*3;
              const rr = rgb[below], gg = rgb[below+1], bb = rgb[below+2];
              if (rr < 155 && gg <= rr && bb <= gg+3) {
                shadedObject = Math.max(shadedObject, clamp((197-r)/22));
                break;
              }
            }
          }
          const a = Math.max(shadedObject,clamp((1 - pink) / .74));
          if (!a) continue;
          alpha += a;
          const backing = (1-a) * Math.min(1, r / rBg);
          red += Math.min(a*255, Math.max(0, r - backing*rBg));
          green += Math.min(a*255, Math.max(0, g - backing*gBg));
          blue += Math.min(a*255, Math.max(0, b - backing*bBg));
        }
      }
      if (alpha < .045) continue;
      const d = (y/2*(width/2)+x/2)*4;
      result[d] = byte(red/alpha); result[d+1] = byte(green/alpha);
      result[d+2] = byte(blue/alpha); result[d+3] = byte(alpha*255/4);
    }
  }
  return result;
}

let pending = Buffer.alloc(0), frames = 0;
try {
  for await (const bytes of decoder.stdout) {
    pending = pending.length ? Buffer.concat([pending,bytes]) : bytes;
    while (pending.length >= frameBytes) {
      const keyed = matte(pending.subarray(0,frameBytes));
      if (!encoder.stdin.write(keyed)) await once(encoder.stdin,'drain');
      pending = pending.subarray(frameBytes);
      frames++;
    }
  }
  await decodeDone; encoder.stdin.end(); await encodeDone;
  if (pending.length || frames !== expected) throw new Error('The input frame count changed during keying');
  writeFileSync(join(folder,'desktop-flow-report.json'),JSON.stringify({
    source, sourceSha256:hash(source), flow, candidate, candidateSha256:hash(candidate),
    width:width/2,height:height/2,frames,fps,framing:'--full-frame',reframed:false,
    ...(roseStudio && {matteProfile:'rose-studio'}),
    frameProcessing:'Per-frame luminance-adaptive magenta hue key at native size, row-wise decontamination and premultiplied 2x spatial reduction',
  },null,2)+'\n');
} catch (error) {
  decoder.kill(); encoder.stdin.destroy(); encoder.kill(); throw error;
}
