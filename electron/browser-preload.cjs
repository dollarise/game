'use strict';

const { ipcRenderer } = require('electron');

// This preload is attached only to the isolated game-browser WebContentsView.
// Page scripts and cross-origin child frames can relay data through postMessage,
// but cannot access Node.js or arbitrary IPC channels.
window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  if (message.type === 'GAME_MOUSE_RECORDING_DIAGNOSTIC' &&
      ['start-received', 'mouse-captured'].includes(message.stage)) {
    ipcRenderer.send('browser:recording-diagnostic', message.stage);
    return;
  }

  if (message.type !== 'GAME_MOUSE_RECORDING_EVENT') return;
  const payload = message.payload;
  if (!payload || !['move', 'click', 'board'].includes(payload.eventType)) return;

  ipcRenderer.send('browser:recording-event', {
    eventType: payload.eventType,
    x: Number.isFinite(payload.x) ? payload.x : null,
    y: Number.isFinite(payload.y) ? payload.y : null,
    button: Number.isInteger(payload.button) ? payload.button : null,
    label: typeof payload.label === 'string' ? payload.label.slice(0, 5000) : null
  });
}, true);
