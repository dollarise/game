'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const path = require('node:path');

const GAME_HOSTS = new Set(['1xlite-6487.com', '1xlite-7498.com']);
const START_URL = 'https://1xlite-6487.com/en/games/solitaire';
let mainWindow;
let browserView;
let browserVisible = false;

function parseHttpUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('Alamat browser tidak valid.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Browser hanya menerima alamat HTTP atau HTTPS.');
  }
  return parsed;
}

function isAllowedSolitaire(urlValue) {
  const url = parseHttpUrl(urlValue);
  return url.protocol === 'https:' && GAME_HOSTS.has(url.hostname) &&
    url.pathname.startsWith('/en/games/solitaire');
}

function sendToUi(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createBrowserView() {
  browserView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'browser-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: 'persist:game-browser'
    }
  });
  mainWindow.contentView.addChildView(browserView);
  browserView.setBounds({ x: 0, y: 0, width: 1, height: 1 });
  browserView.setVisible(false);

  const contents = browserView.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    try { parseHttpUrl(url); } catch { event.preventDefault(); }
  });
  contents.on('did-navigate', (_event, url) => sendToUi('browser:url-changed', url));
  contents.on('did-navigate-in-page', (_event, url) => sendToUi('browser:url-changed', url));
  contents.on('render-process-gone', (_event, details) => {
    sendToUi('browser:error', { message: 'Browser game berhenti: ' + details.reason });
  });
  contents.loadURL(START_URL).catch((error) => {
    sendToUi('browser:error', { message: String(error) });
  });
}

function registerIpc() {
  ipcMain.handle('browser:navigate', async (_event, value) => {
    const url = parseHttpUrl(value);
    await browserView.webContents.loadURL(url.toString());
    return true;
  });
  ipcMain.handle('browser:back', () => {
    if (browserView.webContents.canGoBack()) browserView.webContents.goBack();
    return true;
  });
  ipcMain.handle('browser:forward', () => {
    if (browserView.webContents.canGoForward()) browserView.webContents.goForward();
    return true;
  });
  ipcMain.handle('browser:reload', () => { browserView.webContents.reload(); return true; });
  ipcMain.handle('browser:set-visible', (_event, visible) => {
    browserVisible = Boolean(visible);
    browserView.setVisible(browserVisible);
    return true;
  });
  ipcMain.handle('browser:set-bounds', (_event, bounds) => {
    const values = ['x', 'y', 'width', 'height'].map((key) => Number(bounds?.[key]));
    if (!values.every(Number.isFinite) || values[2] < 1 || values[3] < 1) {
      throw new Error('Ukuran area browser tidak valid.');
    }
    browserView.setBounds({
      x: Math.max(0, Math.round(values[0])),
      y: Math.max(0, Math.round(values[1])),
      width: Math.round(values[2]),
      height: Math.round(values[3])
    });
    browserView.setVisible(true);
    browserVisible = true;
    return true;
  });
  ipcMain.handle('recording:start', async () => {
    const currentUrl = browserView.webContents.getURL();
    if (!isAllowedSolitaire(currentUrl)) {
      throw new Error('Perekaman hanya diizinkan pada halaman Solitaire yang ditentukan.');
    }
    await browserView.webContents.executeJavaScript(
      'window.postMessage({ type: "GAME_MANUAL_START_RECORDING" }, "*");'
    );
    sendToUi('recording:diagnostic', { stage: 'start-message-sent' });
    return { stages: ['native-start-command', 'start-message-sent'], browser_error: null };
  });

  ipcMain.on('browser:recording-event', (event, payload) => {
    if (event.sender !== browserView.webContents) return;
    try {
      if (!isAllowedSolitaire(browserView.webContents.getURL())) return;
      if (!payload || !['move', 'click', 'board'].includes(payload.eventType)) return;
      const clean = {
        eventType: payload.eventType,
        x: Number.isFinite(payload.x) ? payload.x : null,
        y: Number.isFinite(payload.y) ? payload.y : null,
        button: Number.isInteger(payload.button) ? payload.button : null,
        pageUrl: browserView.webContents.getURL(),
        label: typeof payload.label === 'string' ? payload.label.slice(0, 5000) : null
      };
      sendToUi('recording:input', clean);
    } catch { /* Reject malformed page messages without interrupting the app. */ }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 650,
    title: 'GAME',
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  createBrowserView();
  registerIpc();

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  mainWindow.on('resize', () => {
    // The React layout reports exact browser bounds through the secure preload API.
    if (!browserVisible) browserView.setVisible(false);
  });
  mainWindow.on('closed', () => { mainWindow = null; browserView = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
