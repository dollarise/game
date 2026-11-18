const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const path = require('node:path');

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

const CAPTURE_SCRIPT = String.raw`(() => {
  if (window.__GAME_CAPTURE_INSTALLED__) return;
  Object.defineProperty(window, '__GAME_CAPTURE_INSTALLED__', { value: true });
  const emit = (payload) => {
    try {
      if (typeof window.__GAME_CAPTURE === 'function') {
        window.__GAME_CAPTURE(JSON.stringify(payload));
      }
    } catch (_) {}
  };
  const textOf = (node) => {
    if (!(node instanceof Element)) return '';
    return [
      node.textContent, node.getAttribute('aria-label'), node.getAttribute('title'),
      node.getAttribute('data-testid'), node.getAttribute('data-card'),
      node.getAttribute('data-rank'), node.getAttribute('data-suit'), node.getAttribute('alt'),
      node.getAttribute('src'), node.getAttribute('class'), node.getAttribute('style')
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  };
  let lastMoveAt = 0;
  let lastBoardSignature = '';
  let boardTimer = 0;
  let drag = null;
  const boardSnapshot = () => {
    const nodes = [...document.querySelectorAll('[data-card], [data-rank], [class*="card" i], [aria-label*="card" i]')];
    const seen = new Set();
    const cards = [];
    for (const node of nodes) {
      if (!(node instanceof Element) || seen.has(node)) continue;
      seen.add(node);
      const raw = textOf(node);
      if (!raw) continue;
      const rank = raw.match(/\b(ace|king|queen|jack|10|[2-9]|[AJQK])\b/i);
      const suit = raw.match(/\b(spades?|hearts?|diamonds?|clubs?)\b|[♠♥♦♣]/i);
      const code = rank && suit ? ({ace:'A',king:'K',queen:'Q',jack:'J'}[rank[1].toLowerCase()] || rank[1]).toUpperCase() + ({spade:'S',heart:'H',diamond:'D',club:'C'}[String(suit[1]).toLowerCase().replace(/s$/,'')] || ({'♠':'S','♥':'H','♦':'D','♣':'C'}[suit[0]]) || '') : 'UNKNOWN';
      const rect = node.getBoundingClientRect();
      const slot = node.getAttribute('data-pile') || node.getAttribute('data-slot') ||
        (rect.width && rect.height ? Math.round(rect.x / 35) + ':' + Math.round(rect.y / 35) : 'unknown');
      cards.push({ code, faceUp: !/back|down|hidden/i.test(raw), slot: String(slot) });
    }
    if (!cards.length) return null;
    const signature = cards.map(card => card.slot + ':' + card.code + ':' + (card.faceUp ? '1' : '0')).sort().join('|');
    return { cards, signature };
  };
  const captureBoardNow = () => {
    const snapshot = boardSnapshot();
    if (!snapshot) return;
    lastBoardSignature = snapshot.signature;
    emit({ type: 'board', x: 0, y: 0, button: null, label: JSON.stringify(snapshot), pageUrl: location.href });
  };
  window.__GAME_CAPTURE_BOARD__ = captureBoardNow;
  const scheduleBoard = () => {
    clearTimeout(boardTimer);
    boardTimer = setTimeout(() => {
      const snapshot = boardSnapshot();
      if (!snapshot || snapshot.signature === lastBoardSignature) return;
      lastBoardSignature = snapshot.signature;
      emit({ type: 'board', x: 0, y: 0, button: null, label: JSON.stringify(snapshot), pageUrl: location.href });
    }, 220);
  };
  document.addEventListener('pointerdown', (event) => {
    if (!event.isTrusted || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    const buttonElement = target ? target.closest('button,[role="button"],[class*="button" i]') : null;
    const buttonLabel = buttonElement ? [
      buttonElement.textContent, buttonElement.getAttribute('aria-label'), buttonElement.getAttribute('title')
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() : '';
    const label = target ? textOf(target.closest('button,[role="button"],[data-card],[class*="card" i]') || target) : '';
    if (/^(play(?:\s+(?:game|now))?|start(?:\s+(?:game|now|playing))?|mulai(?:\s+permainan)?|play\s*\/\s*start(?:\s+game)?)$/i.test(buttonLabel)) {
      emit({ type: 'auto-start', reason: 'play-start', x: event.clientX, y: event.clientY, label: buttonLabel, pageUrl: location.href });
    }
    drag = { x: event.clientX, y: event.clientY, label, moved: false };
    emit({ type: 'click', x: event.clientX, y: event.clientY, button: event.button, label, pageUrl: location.href });
  }, true);
  document.addEventListener('pointermove', (event) => {
    if (!event.isTrusted) return;
    const now = Date.now();
    if (drag && (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 8)) drag.moved = true;
    if (now - lastMoveAt < 90) return;
    lastMoveAt = now;
    if (drag && drag.moved) emit({ type: 'move', x: event.clientX, y: event.clientY, button: 0, label: drag.label, pageUrl: location.href });
  }, true);
  document.addEventListener('pointerup', (event) => {
    if (!event.isTrusted) return;
    if (drag && drag.moved) emit({ type: 'move', x: event.clientX, y: event.clientY, button: 0, label: drag.label, pageUrl: location.href });
    drag = null;
    scheduleBoard();
  }, true);
  document.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const target = event.target instanceof Element ? event.target : null;
    const label = target ? textOf(target.closest('button,[role="button"],[class*="button" i]') || target) : '';
    if (/give\s*up| menyerah| menyerah/i.test(label)) {
      emit({ type: 'auto-stop', status: 'incomplete', reason: 'give-up', pageUrl: location.href });
    }
    scheduleBoard();
  }, true);
  const observer = new MutationObserver(scheduleBoard);
  const observe = () => {
    if (document.documentElement) observer.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['class','style','src','data-card','data-rank','data-suit','data-pile','data-slot','aria-label']
    });
  };
  observe();
  if (!document.documentElement) document.addEventListener('DOMContentLoaded', observe, { once: true });
  scheduleBoard();
})();`;

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
      if (!recordingActive) return;
      if (payload.type === 'auto-stop') {
        recordingActive = false;
        sendToApp('recording-auto-stop', { status: 'incomplete', reason: payload.reason || 'game-action' });
        return;
      }
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
    if (recordingActive && !isAllowedRecordingPage(url)) {
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
  else void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

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
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  recordingActive = false;
  recordingPaused = false;
  if (process.platform !== 'darwin') app.quit();
});
