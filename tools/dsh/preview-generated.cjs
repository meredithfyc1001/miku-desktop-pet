// Temporary isolated transparent window for checking a generated video on Windows.
const { app, BrowserWindow, screen } = require('electron');
const { mkdtempSync, existsSync, writeFileSync } = require('node:fs');
const { resolve, join, relative, isAbsolute, sep } = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const root = resolve(__dirname, '../..');
const input = process.argv[2] && resolve(process.argv[2]);
const inside = p => { const r = relative(root, p); return !isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep); };
if (!input || !inside(input) || !existsSync(input) || !input.endsWith('.webm')) throw new Error('Pass a generated WebM candidate within the Miku project');
app.setName('Miku video preview');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'miku-video-preview-')));
// Match the desktop runtime's software compositing for transparent video.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(() => {
  const area = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({ title: 'Miku · 视频候选预览', x: area.x + 100, y: area.y + 100, width: 640, height: 360, frame: false, transparent: true, hasShadow: false, resizable: false, alwaysOnTop: true, show: false, showInTaskbar: true, backgroundColor: '#00000000', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  // Show only after the transparent surface is ready, so Windows exposes a
  // capturable window instead of a transient, not-yet-visible one.
  win.once('ready-to-show', () => win.show());
  if (process.argv.includes('--self-check')) win.webContents.once('did-finish-load', () => setTimeout(async () => {
    try {
      const video = await win.webContents.executeJavaScript(`(() => {
        const v = document.querySelector('video');
        return { readyState:v.readyState, paused:v.paused, currentTime:v.currentTime, width:v.videoWidth, height:v.videoHeight, error:v.error?.code ?? null };
      })()`);
      const report = { visible:win.isVisible(), minimized:win.isMinimized(), bounds:win.getContentBounds(), video };
      const shot = await win.webContents.capturePage();
      writeFileSync(join(root, 'artifactsfilm/preview-check.png'), shot.toPNG());
      writeFileSync(join(root, 'artifactsfilm/preview-check.json'), JSON.stringify(report, null, 2));
    } catch (error) {
      writeFileSync(join(root, 'artifactsfilm/preview-check.json'), JSON.stringify({ error:String(error) }, null, 2));
    }
  }, 2500));
  win.webContents.on('before-input-event', (_event, inputEvent) => { if (inputEvent.key === 'Escape') win.close(); });
  setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 60000);
  win.loadFile(join(__dirname, 'preview-generated.html'), { query: { video: pathToFileURL(input).href } });
});
app.on('window-all-closed', () => app.quit());
