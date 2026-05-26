const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {}
  return { serverUrl: '', guildId: '', duration: 8, volume: 1 };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

let overlayWin = null;
let configWin = null;
let tray = null;
let socket = null;
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
    width: 460, height: 420,
    resizable: true,
    minWidth: 400, minHeight: 380,
    title: 'LiveChat Overlay',
    icon: path.join(__dirname, '../assets/icon.ico'),
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  configWin.loadFile(path.join(__dirname, 'config.html'));
  configWin.setMenuBarVisibility(false);
}

function connect(cfg) {
  if (socket) { socket.disconnect(); socket = null; }
  if (!cfg.serverUrl || !cfg.guildId) return;

  const { io } = require('socket.io-client');
  socket = io(cfg.serverUrl, {
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    reconnectionAttempts: Infinity,
    timeout: 10000,
  });

  socket.on('connect', () => {
    socket.emit('register', { guildId: cfg.guildId });
    setTray('connecté ✓');
    console.log('[Socket] Connecté');
  });

  socket.on('registered', () => {
    console.log('[Socket] Enregistré');
  });

  socket.on('show-media', (msg) => {
    if (dnd) return;
    const cfg = loadConfig();
    msg.defaultDuration = cfg.duration || 8;
    msg.volume = typeof cfg.volume === 'number' ? cfg.volume : 1;
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send('show-media', msg);
    }
  });

  socket.on('disconnect', (reason) => {
    setTray(`déconnecté (${reason})`);
    console.log('[Socket] Déconnecté:', reason);
  });

  socket.on('connect_error', (err) => {
    setTray('erreur connexion...');
    console.log('[Socket] Erreur:', err.message);
  });
}

function setTray(status) {
  if (tray) tray.setToolTip(`LiveChat — ${status}`);
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Mise à jour disponible',
      message: 'Une nouvelle version a été téléchargée. L\'app va redémarrer.',
      buttons: ['Redémarrer maintenant', 'Plus tard']
    }).then(result => {
      if (result.response === 0) autoUpdater.quitAndInstall();
    });
  });
  autoUpdater.on('error', () => {});
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
ipcMain.handle('get-startup', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('set-startup', (_, val) => {
  app.setLoginItemSettings({ openAtLogin: val });
});
ipcMain.handle('save-config', (_, cfg) => { saveConfig(cfg); connect(cfg); return true; });
ipcMain.handle('set-dnd', (_, val) => { dnd = val; setTray(val ? 'Ne pas déranger' : 'connecté ✓'); });
ipcMain.handle('get-dnd', () => dnd);
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('media-done', () => {
  if (socket && socket.connected) {
    const cfg = loadConfig();
    socket.emit('done', { guildId: cfg.guildId });
  }
});

app.on('window-all-closed', e => e.preventDefault());
