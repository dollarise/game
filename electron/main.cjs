const { app, BrowserWindow, WebContentsView, ipcMain, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{
  scheme: 'game',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);

const APP_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:1420';
const DEFAULT_GAME_URL = 'https://1xlite-6487.com/en/games/solitaire';
const ALLOWED_GAME_HOSTS = new Set(['1xlite-6487.com', '1xlite-7498.com']);

let mainWindow;
let gameView;
let recordingActive = false;
let recordingPaused = false;
let captureInstalled = false;
let captureMessageListenerAttached = false;
let scriptIdentifier = null;
const captureContextIds = new Map();

const CAPTURE_SCRIPT = require('./capture-script.cjs');;

function sendToApp(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function isAllowedRecordingPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_GAME_HOSTS.has(url.hostname) && url.pathname.startsWith('/en/games/solitaire');
  } catch {
    return false;
  }
}

function attachCapture() {
  if (!gameView || gameView.webContents.isDestroyed()) throw new Error('Browser internal belum siap.');
  const wc = gameView.webContents;
  if (captureInstalled && wc.debugger.isAttached()) return Promise.resolve();
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  if (!captureMessageListenerAttached) {
    wc.debugger.on('message', (_event, method, params) => {
      if (method === 'Runtime.executionContextCreated') {
        const context = params.context;
        if (context?.name === 'GAMERecorder' && context.auxData?.frameId) {
          captureContextIds.set(context.auxData.frameId, context.id);
        }
        return;
      }
      if (method === 'Runtime.executionContextDestroyed') {
        for (const [frameId, contextId] of captureContextIds) {
          if (contextId === params.executionContextId) captureContextIds.delete(frameId);
        }
        return;
      }
      if (method === 'Runtime.executionContextsCleared') {
        captureContextIds.clear();
        return;
      }
      if (method !== 'Runtime.bindingCalled' || params.name !== '__GAME_CAPTURE' || !isAllowedRecordingPage(gameView?.webContents.getURL() || '')) return;
      let payload;
      try { payload = JSON.parse(params.payload); } catch { return; }
      if (!payload || typeof payload.type !== 'string') return;
      if (payload.type === 'auto-start') {
        if (!recordingActive && !recordingPaused) {
          recordingActive = true;
          sendToApp('recording-auto-start', { reason: payload.reason || 'play-start' });
        }
        return;
      }
      if (payload.type === 'auto-stop') {
        if (!recordingActive && !recordingPaused) return;
        recordingActive = false;
        recordingPaused = false;
        sendToApp('recording-auto-stop', { status: 'incomplete', reason: payload.reason || 'game-action' });
        return;
      }
      if (!recordingActive) return;
      if (!['click', 'move', 'board'].includes(payload.type)) return;
      sendToApp('recording-input', {
        type: payload.type,
        x: Number.isFinite(payload.x) ? payload.x : 0,
        y: Number.isFinite(payload.y) ? payload.y : 0,
        button: Number.isInteger(payload.button) ? payload.button : undefined,
        label: typeof payload.label === 'string' ? payload.label : undefined
      });
    });
    captureMessageListenerAttached = true;
  }
  return wc.debugger.sendCommand('Runtime.enable')
    .then(() => wc.debugger.sendCommand('Runtime.addBinding', { name: '__GAME_CAPTURE' }))
    .then(() => wc.debugger.sendCommand('Page.enable'))
    .then(() => wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: CAPTURE_SCRIPT, worldName: 'GAMERecorder' }))
    .then(async (result) => {
      scriptIdentifier = result.identifier;
      captureInstalled = true;
      const tree = await wc.debugger.sendCommand('Page.getFrameTree');
      const frames = [];
      const walk = (node) => {
        if (node.frame && node.frame.id) frames.push(node.frame.id);
        for (const child of node.childFrames || []) walk(child);
      };
      walk(tree.frameTree);
      for (const frameId of frames) {
        try {
          const world = await wc.debugger.sendCommand('Page.createIsolatedWorld', {
            frameId, worldName: 'GAMERecorder', grantUniveralAccess: false
          });
          captureContextIds.set(frameId, world.executionContextId);
          await wc.debugger.sendCommand('Runtime.evaluate', {
            contextId: world.executionContextId, expression: CAPTURE_SCRIPT
          });
        } catch (_) {}
      }
    });
}

async function captureCurrentBoards() {
  if (!gameView || gameView.webContents.isDestroyed() || !gameView.webContents.debugger.isAttached()) return;
  const wc = gameView.webContents;
  for (const contextId of captureContextIds.values()) {
    try {
      await wc.debugger.sendCommand('Runtime.evaluate', {
        contextId,
        expression: "if (typeof window.__GAME_CAPTURE_BOARD__ === 'function') window.__GAME_CAPTURE_BOARD__();"
      });
    } catch (_) {}
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    title: 'GAME V2.0.0',
    backgroundColor: '#0a0e19',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  gameView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true
    }
  });
  mainWindow.contentView.addChildView(gameView);
  gameView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  gameView.setVisible(false);

  const handleBrowserNavigation = (url) => {
    sendToApp('browser-url-changed', url);
    if ((recordingActive || recordingPaused) && !isAllowedRecordingPage(url)) {
      recordingActive = false;
      recordingPaused = false;
      sendToApp('recording-auto-stop', { status: 'incomplete', reason: 'left-game-page' });
    }
  };
  gameView.webContents.on('did-navigate', (_event, url) => handleBrowserNavigation(url));
  gameView.webContents.on('did-navigate-in-page', (_event, url) => handleBrowserNavigation(url));
  gameView.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void gameView.webContents.loadURL(url);
    }
    return { action: 'deny' };
  });
  void attachCapture()
    .catch((error) => console.error('[GAME] Chromium capture will retry on demand:', error))
    .then(() => gameView && !gameView.webContents.isDestroyed() ? gameView.webContents.loadURL(DEFAULT_GAME_URL) : undefined)
    .catch((error) => console.error('[GAME] Failed to load the default game page:', error));

  if (process.env.VITE_DEV_SERVER_URL) void mainWindow.loadURL(APP_URL);
  else void mainWindow.loadURL('game://app/index.html');

  mainWindow.on('closed', () => {
    recordingActive = false;
    recordingPaused = false;
    if (gameView && !gameView.webContents.isDestroyed()) gameView.webContents.close();
    captureInstalled = false;
    gameView = null;
    mainWindow = null;
  });
}

function assertSender(event) {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
    throw new Error('Akses IPC tidak diizinkan.');
  }
}

ipcMain.handle('game:invoke', async (event, command, args = {}) => {
  assertSender(event);
  if (!gameView) throw new Error('Browser internal belum siap.');
  const wc = gameView.webContents;
  switch (command) {
    case 'browser_navigate': {
      const url = new URL(String(args.url || ''));
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Alamat harus HTTP atau HTTPS.');
      await wc.loadURL(url.toString());
      return null;
    }
    case 'browser_back': if (wc.canGoBack()) wc.goBack(); return null;
    case 'browser_forward': if (wc.canGoForward()) wc.goForward(); return null;
    case 'browser_reload': wc.reload(); return null;
    case 'browser_set_bounds': {
      const x = Math.max(0, Number(args.x) || 0);
      const y = Math.max(0, Number(args.y) || 0);
      const width = Math.max(0, Number(args.width) || 0);
      const height = Math.max(0, Number(args.height) || 0);
      gameView.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
      gameView.setVisible(width > 1 && height > 1);
      return null;
    }
    case 'browser_set_visible': gameView.setVisible(Boolean(args.visible)); return null;
    case 'browser_start_recording': {
      const current = wc.getURL();
      if (!isAllowedRecordingPage(current)) throw new Error('Perekaman hanya diizinkan pada halaman Solitaire yang ditentukan.');
      await attachCapture();
      recordingActive = true;
      recordingPaused = false;
      return { stages: ['electron-start-command', 'chromium-cdp-attached', 'capture-script-injected'], browser_error: null };
    }
    case 'recording_snapshot': await captureCurrentBoards(); return null;
    case 'recording_pause': recordingActive = false; recordingPaused = true; return null;
    case 'recording_resume': {
      if (!isAllowedRecordingPage(wc.getURL())) throw new Error('Halaman Solitaire tidak aktif.');
      recordingActive = true;
      recordingPaused = false;
      return null;
    }
    case 'recording_stop': recordingActive = false; recordingPaused = false; return null;
    default: throw new Error('Perintah desktop tidak dikenal: ' + String(command));
  }
});

app.whenReady().then(() => {
  if (!process.env.VITE_DEV_SERVER_URL) {
    protocol.handle('game', (request) => {
      const url = new URL(request.url);
      const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
      const root = path.resolve(app.getAppPath(), 'dist');
      const filePath = path.resolve(root, relativePath);
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    });
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  recordingActive = false;
  recordingPaused = false;
  if (process.platform !== 'darwin') app.quit();
});
