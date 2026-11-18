module.exports = String.raw`(() => {
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
})();;
