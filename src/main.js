const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog } = require('electron');
const { WebSocket } = require('ws');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {}
  return { serverUrl: '', guildId: '', duration: 8 };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

let overlayWin = null;
let configWin = null;
let tray = null;
let ws = null;
let reconnectTimer = null;
let dnd = false;

function createOverlay() {
  const { width, height } = screen.getPrimaryDisplay().bounds;
  overlayWin = new BrowserWindow({
    width, height, x: 0, y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    hasShadow: false,
    type: 'toolbar',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      autoplayPolicy: 'no-user-gesture-required',
    }
  });
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.setAlwaysOnTop(true, 'screen-saver', 1);
  overlayWin.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function createConfigWindow() {
  if (configWin && !configWin.isDestroyed()) { configWin.focus(); return; }
  configWin = new BrowserWindow({
    width: 460, height: 380,
    resizable: false,
    title: 'LiveChat Overlay',
    icon: path.join(__dirname, '../assets/icon.ico'),
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  configWin.loadFile(path.join(__dirname, 'config.html'));
  configWin.setMenuBarVisibility(false);
}

function connect(cfg) {
  if (ws) { try { ws.terminate(); } catch {} ws = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (!cfg.serverUrl || !cfg.guildId) return;

  const url = cfg.serverUrl.replace(/^https?/, 'wss').replace(/\/$/, '');
  ws = new WebSocket(url);

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'register', guildId: cfg.guildId }));
    setTray('connecté ✓');
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.action === 'show' && !dnd) {
        const cfg = loadConfig();
        msg.defaultDuration = cfg.duration || 8;
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send('show-media', msg);
        }
      }
    } catch {}
  });

  ws.on('close', () => {
    setTray('déconnecté — reconnexion...');
    reconnectTimer = setTimeout(() => connect(loadConfig()), 5000);
  });

  ws.on('error', () => {});
}

function setTray(status) {
  if (tray) tray.setToolTip(`LiveChat — ${status}`);
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', () => {
    setTray('Mise à jour en cours...');
  });

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Mise à jour disponible',
      message: 'Une nouvelle version a été téléchargée. L\'app va redémarrer pour l\'installer.',
      buttons: ['Redémarrer maintenant', 'Plus tard']
    }).then(result => {
      if (result.response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', () => {});

  // Vérif au démarrage + toutes les heures
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 3600000);
}

app.whenReady().then(() => {
  createOverlay();
  const cfg = loadConfig();
  if (!cfg.serverUrl || !cfg.guildId) createConfigWindow();
  else connect(cfg);

  const iconPath = path.join(__dirname, '../assets/icon.ico');
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('LiveChat Overlay');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Paramètres', click: createConfigWindow },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() }
  ]));
  tray.on('click', createConfigWindow);

  if (app.isPackaged) setupAutoUpdater();
});

ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('save-config', (_, cfg) => { saveConfig(cfg); connect(cfg); return true; });
ipcMain.handle('set-dnd', (_, val) => { dnd = val; setTray(val ? 'Ne pas déranger' : 'connecté ✓'); });
ipcMain.handle('get-dnd', () => dnd);

app.on('window-all-closed', e => e.preventDefault());
