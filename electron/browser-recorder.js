(() => {
  if (window.__GAME_ELECTRON_RECORDER_INSTALLED__) return;
  window.__GAME_ELECTRON_RECORDER_INSTALLED__ = true;

  let recording = false;
  let dragStart = null;
  let lastMoveAt = 0;
  let lastX = -10000;
  let lastY = -10000;
  const isTopFrame = window.top === window;

  const relay = (eventType, event, label = null) => {
    const payload = {
      eventType,
      x: Number.isFinite(event?.clientX) ? event.clientX : null,
      y: Number.isFinite(event?.clientY) ? event.clientY : null,
      button: Number.isInteger(event?.button) ? event.button : null,
      label
    };
    try { window.top.postMessage({ type: 'GAME_MOUSE_RECORDING_EVENT', payload }, '*'); } catch (_) {}
  };

  const startMessage = { type: 'GAME_MANUAL_START_RECORDING' };
  const notifyFrame = (frame) => {
    if (!(frame instanceof HTMLIFrameElement)) return;
    const notify = () => {
      try { frame.contentWindow?.postMessage(startMessage, '*'); } catch (_) {}
    };
    frame.addEventListener('load', notify);
    if (recording) notify();
  };

  if (isTopFrame) {
    let frameObserver;
    const observeFrames = () => {
      document.querySelectorAll('iframe').forEach(notifyFrame);
      if (frameObserver || !document.documentElement) return;
      frameObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue;
            if (node instanceof HTMLIFrameElement) notifyFrame(node);
            node.querySelectorAll?.('iframe').forEach(notifyFrame);
          }
        }
      });
      frameObserver.observe(document.documentElement, { childList: true, subtree: true });
    };
    window.addEventListener('message', (event) => {
      if (event.data?.type !== 'GAME_MANUAL_START_RECORDING') return;
      recording = true;
      observeFrames();
    });
    observeFrames();
  } else {
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'GAME_MANUAL_START_RECORDING') recording = true;
    });
  }

  document.addEventListener('pointerdown', (event) => {
    if (!recording || !event.isTrusted) return;
    if (event.button === 0) dragStart = { x: event.clientX, y: event.clientY };
    relay('click', event, event.button === 0 ? 'Tekan area permainan' : 'Klik area permainan');
  }, { capture: true, passive: true });

  document.addEventListener('pointerup', (event) => {
    if (!recording || !event.isTrusted || event.button !== 0 || !dragStart) return;
    const start = dragStart;
    dragStart = null;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 7) {
      relay('click', event, 'Seret dari (' + Math.round(start.x) + ', ' + Math.round(start.y) +
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
    relay('move', event);
  }, { capture: true, passive: true });
})();
