'use strict';

const { ipcRenderer } = require('electron');

// This preload runs in the dedicated game WebContentsView. It captures only
// trusted pointer input after the user starts a GAME-owned recording session.
let recording = false;
let lastMoveAt = 0;
let lastX = -10000;
let lastY = -10000;
let dragStart = null;

function send(eventType, event, label = null) {
  ipcRenderer.send('browser:recording-event', {
    eventType,
    x: Number.isFinite(event?.clientX) ? event.clientX : null,
    y: Number.isFinite(event?.clientY) ? event.clientY : null,
    button: Number.isInteger(event?.button) ? event.button : null,
    label
  });
}

window.addEventListener('message', (event) => {
  if (event.data?.type !== 'GAME_MANUAL_START_RECORDING') return;
  recording = true;
  ipcRenderer.send('browser:recording-diagnostic', 'start-received');
}, true);

document.addEventListener('pointerdown', (event) => {
  if (!recording || !event.isTrusted) return;
  if (event.button === 0) dragStart = { x: event.clientX, y: event.clientY };
  send('click', event, event.button === 0 ? 'Tekan area permainan' : 'Klik area permainan');
}, { capture: true, passive: true });

document.addEventListener('pointerup', (event) => {
  if (!recording || !event.isTrusted || event.button !== 0 || !dragStart) return;
  const start = dragStart;
  dragStart = null;
  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 7) {
    send('click', event, 'Seret dari (' + Math.round(start.x) + ', ' + Math.round(start.y) +
      ') ke (' + Math.round(event.clientX) + ', ' + Math.round(event.clientY) + ')');
  }
}, { capture: true, passive: true });

document.addEventListener('pointermove', (event) => {
  if (!recording || !event.isTrusted) return;
  const now = performance.now();
  if (now - lastMoveAt < 35 ||
      (Math.abs(event.clientX - lastX) < 2 && Math.abs(event.clientY - lastY) < 2)) return;
  lastMoveAt = now;
  lastX = event.clientX;
  lastY = event.clientY;
  send('move', event);
}, { capture: true, passive: true });
