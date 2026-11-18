
(() => {
  // This script is injected into every frame in GAME's dedicated Electron Chromium browser.
  // Install in every frame: cross-origin game frames may hide their referrer,
  // so URL/referrer gating here can silently prevent the actual game frame
  // from receiving mouse listeners. The Electron main process still validates
  // the top-level Solitaire URL before accepting any event.
  if (window.__GAME_MOUSE_RECORDING_INSTALLED__) return;
  // Install listeners before the Electron start signal arrives.
  // Manual start is delivered by postMessage; event transport is checked per call.
  window.__GAME_MOUSE_RECORDING_INSTALLED__ = true;
  const invoke = (command, payload = {}) => {
    if (command === 'recording_diagnostic') {
      window.top.postMessage({ type: 'GAME_ELECTRON_RECORDING_DIAGNOSTIC_TO_NATIVE', stage: payload.stage }, '*');
      return Promise.resolve();
    }
    if (command === 'recording_event') {
      window.top.postMessage({ type: 'GAME_ELECTRON_RECORDING_EVENT_TO_NATIVE', payload }, '*');
      return Promise.resolve();
    }
    return Promise.reject(new Error('Perintah perekam tidak dikenal.'));
  };
  let started = false;
  let dragStart = null;
  let suppressClickUntil = 0;
  const isTopFrame = window.top === window;
  const reportDiagnostic = (stage) => {
    if (isTopFrame) void invoke('recording_diagnostic', { stage }).catch((error) => console.warn('[GAME recording] Diagnostic failed:', error));
    else { try { window.top.postMessage({ type: 'GAME_MOUSE_RECORDING_DIAGNOSTIC', stage }, '*'); } catch (_) {} }
  };
  let reportedMouseCapture = false;
  let reportedRelay = false;
  const send = (eventType, data = {}) => {
    const payload = {
      eventType,
      x: Number.isFinite(data.x) ? data.x : null,
      y: Number.isFinite(data.y) ? data.y : null,
      button: Number.isInteger(data.button) ? data.button : null,
      pageUrl: location.href,
      label: data.label || null
    };
    // The Electron IPC bridge is not available inside cross-origin game
    // iframes. Relay their captured input to the top-level GAME webview, where
    // the top-level Electron preload is available, instead of silently dropping the event.
    if (!isTopFrame) {
      window.top.postMessage({ type: 'GAME_MOUSE_RECORDING_EVENT', payload }, '*');
      return Promise.resolve();
    }
    return invoke('recording_event', payload).catch((error) => {
      console.warn('[GAME recording] Native event delivery failed:', error);
    });
  };
  if (isTopFrame) {
    window.addEventListener('message', (event) => {
      if (!event.data) return;
      if (event.data.type === 'GAME_MOUSE_RECORDING_DIAGNOSTIC') { if (typeof event.data.stage === 'string') reportDiagnostic(event.data.stage); return; }
      if (!started || event.data.type !== 'GAME_MOUSE_RECORDING_EVENT') return;
      if (!reportedRelay) { reportedRelay = true; reportDiagnostic('iframe-event-relayed'); }
      const payload = event.data.payload;
      if (!payload || !['move', 'click', 'board'].includes(payload.eventType)) return;
      void invoke('recording_event', payload).catch((error) => {
        console.warn('[GAME recording] Relayed event delivery failed:', error);
      });
    });
  }
  const labelOf = (element) => {
    if (!(element instanceof Element)) return '';
    return [
      element.textContent,
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('data-testid'),
      element.getAttribute('data-icon'),
      element.getAttribute('data-lucide'),
      element.getAttribute('alt'),
      element.getAttribute('src'),
      element.getAttribute('class'),
      element.className && typeof element.className === 'string' ? element.className : ''
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  };
  const cardLabelOf = (target) => {
    if (!(target instanceof Element)) return '';
    const card = target.closest('[class*="card"],[data-card],[data-testid*="card"],[aria-label*="card" i]');
    if (!card) return '';
    const description = labelOf(card);
    const match = description.match(/(?:^|\b)(ace|king|queen|jack|10|[2-9]|[AJQK])\s*(?:of\s*)?(spades?|hearts?|diamonds?|clubs?|♠|♥|♦|♣)(?:\b|$)/i);
    return match ? 'kartu ' + match[0].trim() : 'kartu (identitas belum terbaca)';
  };
  let lastBoardSignature = '';
  let boardCaptureTimer = 0;
  let boardObserver = null;
  let reportedBoardCandidates = false;
  let reportedNoBoardElements = false;
  let reportedBoardSnapshot = false;
  const startBoardObserver = () => {
    if (boardObserver || !document.documentElement) return;
    boardObserver = new MutationObserver(() => scheduleBoardCapture(260));
    boardObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'src', 'style', 'data-card', 'data-rank', 'data-suit', 'aria-label'] });
  };
  const stopBoardObserver = () => {
    if (boardObserver) boardObserver.disconnect();
    boardObserver = null;
    lastBoardSignature = '';
  };
  const visualIdentityOf = (root, descendants) => {
    const style = getComputedStyle(root);
    const parts = [
      root.getAttribute('data-card'), root.getAttribute('data-value'),
      root.getAttribute('data-rank'), root.getAttribute('data-suit'),
      root.getAttribute('aria-label'), root.getAttribute('title'),
      root.getAttribute('alt'), root.getAttribute('src'), root.getAttribute('href'), root.getAttribute('xlink:href'), root.getAttribute('fill'), root.getAttribute('transform'), root.textContent,
      root.namespaceURI === 'http://www.w3.org/2000/svg' ? root.outerHTML : '',
      style.backgroundImage, style.backgroundPosition, style.backgroundSize,
      ...descendants.flatMap((item) => [item.currentSrc, item.getAttribute('src'), item.getAttribute('href'), item.getAttribute('xlink:href'), item.getAttribute('data-src'), item.getAttribute('alt'), item.getAttribute('title'), item.getAttribute('data-rank'), item.getAttribute('data-suit')])
    ].filter(Boolean).join('|').replace(/\s+/g, ' ').trim().slice(0, 1200);
    if (!parts || !/(?:https?:|data:image|url\(|data-card|data-rank|data-suit|\.(?:png|jpe?g|webp|svg)(?:[?#]|$))/i.test(parts)) return '';
    let hash = 2166136261;
    for (let index = 0; index < parts.length; index += 1) { hash ^= parts.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return 'visual-' + (hash >>> 0).toString(16);
  };
  const cardCodeOf = (raw) => {
    const text = String(raw || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const long = text.match(/\b(ace|king|queen|jack|10|[2-9]|[AJQK])\s*(?:of\s*)?(spades?|hearts?|diamonds?|clubs?|♠|♥|♦|♣)\b/i);
    if (long) {
      const rank = ({ ace:'A', king:'K', queen:'Q', jack:'J' })[long[1].toLowerCase()] || long[1].toUpperCase();
      const suitText = long[2].toLowerCase();
      const suit = /spade|♠/.test(suitText) ? 'S' : /heart|♥/.test(suitText) ? 'H' : /diamond|♦/.test(suitText) ? 'D' : 'C';
      return rank + suit;
    }
    const fileCode = String(raw || '').match(/(?:^|[\/_.\-\s])((?:10|[A2-9TJQK]))[_-]?([CDHS])(?=[\/_.\-\s]|$)/i);
    if (fileCode) return fileCode[1].toUpperCase() + fileCode[2].toUpperCase();
    return '';
  };
  const captureBoard = () => {
    if (!started) return;
    const selector = '[data-card],[data-rank],[class*="card" i],[aria-label*="card" i],img[src*="card" i],img,[style*="background-image" i],svg g,svg image,svg use,svg text,svg [aria-label]';
    // SVGElement is not an HTMLElement. The previous filter silently discarded
    // SVG-rendered playing cards, leaving mouse events but zero board snapshots.
    const rawNodes = Array.from(document.querySelectorAll(selector)).filter((node) => node instanceof Element);
    const candidates = [];
    const seenElements = new Set();
    for (const node of rawNodes) {
      // Prefer the card wrapper so its child image is not counted as a second card.
      const root = node.closest('[data-card],[class*="card" i],[aria-label*="card" i]') || node.closest('svg g') || node;
      if (!(root instanceof Element) || seenElements.has(root)) continue;
      seenElements.add(root);
      const rect = root.getBoundingClientRect();
      if (rect.width < 12 || rect.height < 18 || rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) continue;
      const descendants = Array.from(root.querySelectorAll('img,image,use,text,[data-rank],[data-suit]'));
      const raw = [
        root.getAttribute('aria-label'), root.getAttribute('title'), root.getAttribute('data-card'),
        root.getAttribute('data-value'), root.getAttribute('data-rank'), root.getAttribute('data-suit'),
        root.getAttribute('alt'), root.getAttribute('src'), root.getAttribute('href'), root.getAttribute('xlink:href'), root.getAttribute('fill'), root.getAttribute('transform'), root.className, root.textContent,
        ...descendants.flatMap((item) => [
          item.getAttribute('aria-label'), item.getAttribute('alt'), item.getAttribute('title'),
          item.getAttribute('src'), item.getAttribute('href'), item.getAttribute('xlink:href'), item.getAttribute('data-rank'), item.getAttribute('data-suit')
        ])
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const code = cardCodeOf(raw);
      const faceDown = /back|covered|hidden|face[\s_-]*down|card[\s_-]*back/i.test(raw);
      const visualId = visualIdentityOf(root, descendants);
      const cardLike = /card|playing|solitaire|rank|suit/i.test(raw);
      const ratio = rect.width / Math.max(1, rect.height);
      const isSvgGraphic = root.namespaceURI === 'http://www.w3.org/2000/svg' && /^(g|image|use|svg)$/i.test(root.tagName);
      const genericVisual = (node instanceof HTMLImageElement || isSvgGraphic || /background-image/i.test(root.getAttribute('style') || '')) && rect.width >= 28 && rect.height >= 42 && ratio >= 0.48 && ratio <= 0.9;
      if (!code && !faceDown && !cardLike && !genericVisual) continue;
      candidates.push({ root, rect, raw, visualId, code: faceDown ? 'BACK' : (code || 'UNKNOWN'), faceUp: !faceDown });
    }
    if (!candidates.length) {
      if (!reportedNoBoardElements) { reportedNoBoardElements = true; reportDiagnostic('board-elements-not-found'); }
      return;
    }
    if (!reportedBoardCandidates) { reportedBoardCandidates = true; reportDiagnostic('board-cards-detected'); }

    // Build logical pile/stack positions from the board's relative geometry,
    // not from raw screen pixels. Keep top-row piles separate from tableau.
    const minY = Math.min(...candidates.map((item) => item.rect.top));
    const maxY = Math.max(...candidates.map((item) => item.rect.bottom));
    const splitY = minY + (maxY - minY) * 0.25;
    const groups = new Map();
    for (const item of candidates) {
      const zone = item.rect.top + item.rect.height / 2 < splitY ? 'top' : 'tableau';
      const centerX = item.rect.left + item.rect.width / 2;
      const group = groups.get(zone) || [];
      group.push({ ...item, centerX });
      groups.set(zone, group);
    }
    const cards = [];
    for (const [zone, items] of groups) {
      const centers = items.map((item) => item.centerX).sort((a, b) => a - b);
      const columns = [];
      for (const center of centers) {
        const last = columns[columns.length - 1];
        if (last && Math.abs(last.center - center) <= Math.max(18, innerWidth * 0.025)) {
          last.values.push(center);
          last.center = last.values.reduce((sum, value) => sum + value, 0) / last.values.length;
        } else columns.push({ center, values: [center] });
      }
      for (const item of items) {
        let pileIndex = 0;
        let distance = Infinity;
        columns.forEach((column, index) => {
          const nextDistance = Math.abs(column.center - item.centerX);
          if (nextDistance < distance) { distance = nextDistance; pileIndex = index; }
        });
        const pileItems = items.filter((candidate) => {
          let nearest = 0, nearestDistance = Infinity;
          columns.forEach((column, index) => {
            const nextDistance = Math.abs(column.center - candidate.centerX);
            if (nextDistance < nearestDistance) { nearestDistance = nextDistance; nearest = index; }
          });
          return nearest === pileIndex;
        }).sort((a, b) => a.rect.top - b.rect.top);
        const stackIndex = pileItems.indexOf(item);
        const slot = zone + ':' + String(pileIndex + 1).padStart(2, '0') + ':' + String(stackIndex + 1).padStart(2, '0');
        cards.push({ code: item.faceUp ? item.code : 'BACK', faceUp: item.faceUp, slot, ...(item.faceUp && item.visualId ? { visualId: item.visualId } : {}) });
      }
    }
    cards.sort((a, b) => a.slot.localeCompare(b.slot) || a.code.localeCompare(b.code));
    const signature = cards.map((card) => card.slot + '=' + card.code + (card.faceUp ? ':' + (card.visualId || 'UP') : ':DOWN')).join('|');
    if (!signature || signature === lastBoardSignature) return;
    lastBoardSignature = signature;
    if (!reportedBoardSnapshot) { reportedBoardSnapshot = true; reportDiagnostic('board-snapshot-captured'); }
    return send('board', { label: JSON.stringify({ cards, signature }) });
  };
  const scheduleBoardCapture = (delay = 300) => {
    if (boardCaptureTimer) window.clearTimeout(boardCaptureTimer);
    boardCaptureTimer = window.setTimeout(() => { boardCaptureTimer = 0; captureBoard(); }, delay);
  };
  // Forward the manual start signal to current and future nested frames.
  // Solitaire can create or reload its cross-origin game iframe after the
  // toolbar starts recording, so a one-time scan is not sufficient.
  let frameStartObserver = null;
  const startMessage = { type: 'GAME_MANUAL_START_RECORDING' };
  const notifyFrameStarted = (frame) => {
    if (!(frame instanceof HTMLIFrameElement)) return;
    const notify = () => {
      try { frame.contentWindow?.postMessage(startMessage, '*'); reportDiagnostic('iframe-start-sent'); } catch (_) {}
    };
    frame.addEventListener('load', notify);
    notify();
  };
  const observeAndStartFrames = () => {
    for (const frame of Array.from(document.querySelectorAll('iframe'))) notifyFrameStarted(frame);
    if (frameStartObserver || !document.documentElement) return;
    frameStartObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (!(node instanceof Element)) continue;
          if (node instanceof HTMLIFrameElement) notifyFrameStarted(node);
          for (const frame of Array.from(node.querySelectorAll('iframe'))) notifyFrameStarted(frame);
        }
      }
    });
    frameStartObserver.observe(document.documentElement, { childList: true, subtree: true });
  };
  // Start capture only when the user presses Rekam in the GAME toolbar.
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'GAME_MANUAL_START_RECORDING') return;
    reportDiagnostic('start-received');
    if (!started) {
      started = true;
      startBoardObserver();
      scheduleBoardCapture(350);
    }
    observeAndStartFrames();
  });
  // Capture at pointerdown rather than waiting for click: some game canvases
  // prevent the synthetic click event or keep pointer capture during a drag.
  // This records the user's actual press immediately, including taps on cards.
  document.addEventListener('pointerdown', (event) => {
    if (!started || !event.isTrusted) return;
    const target = event.target;
    const cardLabel = cardLabelOf(target);
    if (event.button === 0) {
      dragStart = { x: event.clientX, y: event.clientY, card: cardLabel };
      void send('click', {
        x: event.clientX,
        y: event.clientY,
        button: event.button,
        label: cardLabel ? 'Tekan ' + cardLabel : 'Tekan area permainan'
      });
      if (!reportedMouseCapture) { reportedMouseCapture = true; reportDiagnostic('mouse-captured'); }
      return;
    }
    const control = target instanceof Element ? target.closest('button,[role="button"],a,[tabindex]') : null;
    void send('click', { x: event.clientX, y: event.clientY, button: event.button, label: control ? labelOf(control).slice(0, 120) : 'Klik kanan area permainan' });
  }, { capture: true, passive: true });
  document.addEventListener('pointerup', (event) => {
    if (!started || event.button !== 0 || !dragStart) return;
    const source = dragStart;
    dragStart = null;
    if (Math.hypot(event.clientX - source.x, event.clientY - source.y) < 7) {
      // Stock draws, single-card taps, and automatic reveals may not produce
      // a useful DOM mutation. Always compare the board after a click as well.
      window.setTimeout(captureBoard, 420);
      return;
    }
    const destination = cardLabelOf(event.target) || 'posisi tujuan';
    suppressClickUntil = Date.now() + 800;
    const label = 'Pindahkan ' + (source.card || 'kartu/objek') + ' ke ' + destination;
    void send('click', { x: event.clientX, y: event.clientY, button: 0, label })
      .then(() => window.setTimeout(captureBoard, 350));
  }, { capture: true, passive: true });

})();