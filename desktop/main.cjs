// Desktop build (Steam / itch.io): hosts the game server in-process (single player + LAN hosting)
// and shows the game in a fullscreen window. Run with `npm run desktop` (after `npm install` in desktop/).
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// a game must never be throttled when unfocused or behind other windows
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let server = null;

async function start() {
  const { startGameServer } = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'server.js')).href);
  const quiet = () => {};
  // LAN hosting on the usual port when it is free, otherwise any free port
  try { server = await startGameServer({ port: +process.env.PORT || 3000, log: quiet }); } catch { server = await startGameServer({ port: 0, log: quiet }); }
  Menu.setApplicationMenu(null);
  const windowed = process.argv.includes('--windowed');
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 540, fullscreen: !windowed, show: false,
    backgroundColor: '#000000', title: 'Backrooms: Bodycam', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-prevent-unload', (e) => e.preventDefault()); // closing the window always works
  await win.loadURL(`http://127.0.0.1:${server.port}/?desktop`);
}

app.whenReady().then(start).catch((e) => { console.error(e); app.quit(); });
app.on('window-all-closed', async () => { if (server) await server.close(); app.quit(); });
