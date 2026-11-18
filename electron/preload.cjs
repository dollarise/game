const { contextBridge, ipcRenderer } = require('electron');

const allowedEvents = new Set([
  'recording-input',
  'recording-diagnostic',
  'recording-auto-stop',
  'browser-url-changed'
]);

contextBridge.exposeInMainWorld('gameDesktop', {
  isDesktop: true,
  invoke: (command, args) => ipcRenderer.invoke('game:invoke', command, args || {}),
  listen: (channel, callback) => {
    if (!allowedEvents.has(channel)) throw new Error('Kanal event tidak diizinkan.');
    const listener = (_event, payload) => callback({ payload });
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
