'use strict';

const { ipcRenderer } = require('electron');

// This preload is attached only to the isolated game-browser WebContentsView.
// Cross-origin child frames relay data to the top frame with postMessage;
// only these two explicit message types are forwarded to the main process.
window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  if (message.type === 'GAME_ELECTRON_RECORDING_DIAGNOSTIC_TO_NATIVE' &&
      ['native-start-command', 'start-message-sent', 'start-received', 'iframe-start-sent',
       'mouse-captured', 'iframe-event-relayed', 'board-elements-not-found',
       'board-cards-detected', 'board-snapshot-captured'].includes(message.stage)) {
    ipcRenderer.send('browser:recording-diagnostic', message.stage);
    return;
  }

  if (message.type !== 'GAME_ELECTRON_RECORDING_EVENT_TO_NATIVE') return;
  const payload = message.payload;
  if (!payload || !['click', 'board'].includes(payload.eventType)) return;

  ipcRenderer.send('browser:recording-event', {
    eventType: payload.eventType,
    x: Number.isFinite(payload.x) ? payload.x : null,
    y: Number.isFinite(payload.y) ? payload.y : null,
    button: Number.isInteger(payload.button) ? payload.button : null,
    label: typeof payload.label === 'string' ? payload.label.slice(0, 5000) : null
  });
}, true);
