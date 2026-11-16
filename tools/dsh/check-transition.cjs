// Compare the existing fade and an isolated additive fade using the same real video frame.
const { app, BrowserWindow } = require('electron');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync, writeFileSync } = require('node:fs');
const root = resolve(__dirname, '../..');
const video = join(root, 'assets/video-production/revised/shy/aligned-candidate.webm');
const output = join(root, 'artifactsfilm/transition-test');
mkdirSync(output, { recursive: true });
app.setName('Miku transition test');
app.setPath('userData', join(output, 'chromium'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1920, height: 360, useContentSize: true, frame: false, show: false, webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await win.loadFile(join(__dirname, 'transition-fixture.html'), { query: { src: pathToFileURL(video).href } });
  await Promise.race([
    win.webContents.executeJavaScript('window.fixtureReady'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Fixture timed out')), 15000))
  ]);
  const result = { plusLighterSupported: await win.webContents.executeJavaScript("CSS.supports('mix-blend-mode', 'plus-lighter')"), cases: [] };
  if (!result.plusLighterSupported) throw new Error('This Electron version does not support the tested blend mode');
  for (const background of ['rgb(20,45,60)', 'rgb(255,255,255)', 'rgb(140,30,110)']) for (const phase of [0, .25, .5, .75, 1]) {
    await win.webContents.executeJavaScript(`window.setPhase(${phase}, ${JSON.stringify(background)})`);
    const image = await win.webContents.capturePage();
    const bitmap = image.toBitmap();
    const { width, height } = image.getSize();
    if (width !== 1920 || height !== 360) throw new Error(`Unexpected fixture size ${width}x${height}`);
    let ordinary = 0, additive = 0, changedOrdinary = 0, changedAdditive = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < 640; x++) {
      const p = (y * width + x) * 4, q = p + 640 * 4, r = p + 1280 * 4;
      for (let c = 0; c < 3; c++) {
        const a = Math.abs(bitmap[p + c] - bitmap[q + c]);
        const b = Math.abs(bitmap[p + c] - bitmap[r + c]);
        ordinary += a; additive += b;
        if (a > 4) changedOrdinary++;
        if (b > 4) changedAdditive++;
      }
    }
    const sample = { background, phase, ordinaryMeanDifference: ordinary / (640 * height * 3), additiveMeanDifference: additive / (640 * height * 3), ordinaryChannelsOver4: changedOrdinary, additiveChannelsOver4: changedAdditive };
    result.cases.push(sample);
    if (sample.additiveMeanDifference > .5 || sample.additiveChannelsOver4 > 100) throw new Error(`Unexpected blended frame: ${JSON.stringify(sample)}`);
    if (phase === .5 && background === 'rgb(20,45,60)') {
      if (sample.ordinaryMeanDifference < 1) throw new Error('Fixture did not reproduce the old transparency dip');
      writeFileSync(join(output, '视频过渡对比.png'), image.toPNG());
    }
  }
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  win.destroy(); app.quit();
}).catch(err => { writeFileSync(join(output, 'error.txt'), String(err.stack || err)); console.error(err); app.exit(1); });
