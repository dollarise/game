'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') throw new TypeError('Callback harus berupa fungsi.');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('gameDesktop', Object.freeze({
  isDesktop: true,
  browser: Object.freeze({
    navigate: (url) => invoke('browser:navigate', String(url)),
    back: () => invoke('browser:back'),
    forward: () => invoke('browser:forward'),
    reload: () => invoke('browser:reload'),
    setVisible: (visible) => invoke('browser:set-visible', Boolean(visible)),
    setBounds: (bounds) => invoke('browser:set-bounds', bounds),
    startRecording: () => invoke('recording:start')
  }),
  onBrowserUrlChanged: (callback) => subscribe('browser:url-changed', callback),
  onBrowserError: (callback) => subscribe('browser:error', callback),
  onRecordingInput: (callback) => subscribe('recording:input', callback),
  onRecordingDiagnostic: (callback) => subscribe('recording:diagnostic', callback)
}));
