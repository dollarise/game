'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// This preload belongs only to the isolated game-browser contents. It exposes
// one narrow event transport; it does not expose Node.js or arbitrary IPC.
contextBridge.exposeInMainWorld('gameBrowserBridge', Object.freeze({
  sendRecordingEvent: (payload) => {
    if (!payload || !['move', 'click', 'board'].includes(payload.eventType)) return;
    ipcRenderer.send('browser:recording-event', {
      eventType: payload.eventType,
      x: Number.isFinite(payload.x) ? payload.x : null,
      y: Number.isFinite(payload.y) ? payload.y : null,
      button: Number.isInteger(payload.button) ? payload.button : null,
      label: typeof payload.label === 'string' ? payload.label.slice(0, 5000) : null
    });
  }
}));
