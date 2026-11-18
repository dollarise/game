#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Emitter, Manager};
use tauri::webview::{Webview, WebviewBuilder};
use tauri::WebviewUrl;

fn browser_view(app: &AppHandle) -> Result<Webview, String> {
    app.get_webview("game-browser")
        .ok_or_else(|| "Browser internal belum siap.".to_string())
}

#[tauri::command]
fn browser_navigate(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|error| error.to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Browser hanya menerima alamat HTTP atau HTTPS.".to_string());
    }
    browser_view(&app)?.navigate(parsed).map_err(|error| error.to_string())
}

#[tauri::command]
fn browser_start_recording(app: AppHandle) -> Result<RecordingStartResult, String> {
    let view = browser_view(&app)?;
    let current = view.url().map_err(|error| error.to_string())?;
    let is_solitaire_page = current.scheme() == "https"
        && matches!(current.host_str(), Some("1xlite-6487.com" | "1xlite-7498.com"))
        && current.path().starts_with("/en/games/solitaire");
    if !is_solitaire_page {
        return Err("Perekaman hanya diizinkan pada halaman Solitaire yang ditentukan.".to_string());
    }
    // Report the native command path independently of the injected page script.
    // This distinguishes a toolbar/native bridge failure from a page-script failure.
    let mut stages = vec!["native-start-command".to_string()];
    let _ = app.emit("recording-diagnostic", RecordingDiagnostic { stage: "native-start-command".to_string() });
    // Recording state is controlled only by the GAME toolbar. This message
    // merely enables mouse-event capture inside the game frames.
    let browser_error = match view.eval("window.postMessage({ type: 'GAME_MANUAL_START_RECORDING' }, '*');") {
        Ok(()) => {
            stages.push("start-message-sent".to_string());
            let _ = app.emit("recording-diagnostic", RecordingDiagnostic { stage: "start-message-sent".to_string() });
            None
        }
        Err(error) => Some(error.to_string()),
    };
    Ok(RecordingStartResult { stages, browser_error })
}

#[tauri::command]
fn browser_back(app: AppHandle) -> Result<(), String> {
    browser_view(&app)?.eval("window.history.back();").map_err(|error| error.to_string())
}

#[tauri::command]
fn browser_forward(app: AppHandle) -> Result<(), String> {
    browser_view(&app)?.eval("window.history.forward();").map_err(|error| error.to_string())
}

#[tauri::command]
fn browser_reload(app: AppHandle) -> Result<(), String> {
    browser_view(&app)?.reload().map_err(|error| error.to_string())
}

#[tauri::command]
fn browser_set_bounds(app: AppHandle, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    let view = browser_view(&app)?;
    view.set_position(tauri::LogicalPosition::new(x, y)).map_err(|error| error.to_string())?;
    view.set_size(tauri::LogicalSize::new(width, height)).map_err(|error| error.to_string())?;
    view.show().map_err(|error| error.to_string())
}

#[tauri::command]
fn browser_set_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let view = browser_view(&app)?;
    if visible {
        view.show().map_err(|error| error.to_string())
    } else {
        view.hide().map_err(|error| error.to_string())
    }
}


#[derive(Clone, serde::Serialize)]
struct RecordingInput {
    #[serde(rename = "type")]
    kind: String,
    x: Option<f64>,
    y: Option<f64>,
    button: Option<i32>,
    label: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct RecordingDiagnostic { stage: String }

#[derive(serde::Serialize)]
struct RecordingStartResult { stages: Vec<String>, browser_error: Option<String> }

#[tauri::command]
fn recording_diagnostic(webview: Webview, app: AppHandle, stage: String) -> Result<(), String> {
    if webview.label() != "game-browser" { return Err("Diagnosis hanya diterima dari browser GAME.".to_string()); }
    let allowed = ["native-start-command", "start-message-sent", "start-received", "iframe-start-sent", "mouse-captured", "iframe-event-relayed", "solitaire-canvas-found", "vue-root-found", "vue-root-not-found", "game-table-found", "game-columns-found", "game-cards-found", "game-cards-unreadable"];
    if !allowed.contains(&stage.as_str()) { return Err("Tahap diagnosis tidak dikenal.".to_string()); }
    app.emit("recording-diagnostic", RecordingDiagnostic { stage }).map_err(|error| error.to_string())
}

#[tauri::command]
fn recording_event(
    webview: Webview,
    app: AppHandle,
    event_type: String,
    x: Option<f64>,
    y: Option<f64>,
    button: Option<i32>,
    page_url: String,
    label: Option<String>,
) -> Result<(), String> {
    if webview.label() != "game-browser" {
        return Err("Peristiwa rekaman hanya diterima dari browser GAME.".to_string());
    }
    // Validate the top-level GAME browser URL. The game can render its controls
    // inside a cross-origin iframe, so the child frame URL is not authoritative.
    let current = webview.url().map_err(|error| error.to_string())?;
    let is_solitaire_page = current.scheme() == "https"
        && matches!(current.host_str(), Some("1xlite-6487.com" | "1xlite-7498.com"))
        && current.path().starts_with("/en/games/solitaire");
    if !is_solitaire_page {
        return Err("Perekaman hanya diizinkan pada halaman Solitaire yang ditentukan.".to_string());
    }
    let _ = page_url;
    // Game-page controls/text must never start, pause, complete, or stop a
    // recording. Only raw mouse/board data is accepted from the game webview.
    match event_type.as_str() {
        "move" | "click" | "board" => app.emit("recording-input", RecordingInput {
            kind: event_type.clone(),
            x,
            y,
            button,
            label,
        }).map_err(|error| error.to_string()),
        _ => Err("Perintah kontrol rekaman dari halaman game dinonaktifkan.".to_string()),
    }
}

const MOUSE_RECORDING_SCRIPT: &str = r#"
(() => {
  // This script is injected only into GAME's dedicated game-browser WebView.
  // Install in every frame: cross-origin game frames may hide their referrer,
  // so URL/referrer gating here can silently prevent the actual game frame
  // from receiving mouse listeners. Native recording_event still validates
  // the top-level Solitaire URL before accepting any event.
  if (window.__GAME_MOUSE_RECORDING_INSTALLED__) return;
  // Install listeners even if the Tauri bridge is injected slightly later.
  // Manual start is delivered by postMessage; event transport is checked per call.
  window.__GAME_MOUSE_RECORDING_INSTALLED__ = true;
  const invoke = (...args) => {
    const bridge = window.__TAURI_INTERNALS__;
    if (!bridge || typeof bridge.invoke !== 'function') {
      return Promise.reject(new Error('Bridge Tauri belum tersedia.'));
    }
    return bridge.invoke(...args);
  };
  let started = false;
  let lastMoveAt = 0;
  let lastX = -10000;
  let lastY = -10000;
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
    // Tauri's invoke bridge is not guaranteed to exist in cross-origin game
    // iframes. Relay their captured input to the top-level GAME webview, where
    // the native bridge is available, instead of silently dropping the event.
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
  // Read the live Solitaire model from Vue's component tree before falling back
  // to DOM selectors. The game board itself is a WebGL canvas, so DOM card
  // selectors cannot describe its tableau.
  const findLiveTable = () => {
    const roots = [];
    const rootSeen = new Set();
    const addRoot = (instance) => {
      if (instance && !rootSeen.has(instance)) { rootSeen.add(instance); roots.push(instance); }
    };
    for (const element of Array.from(document.querySelectorAll('*'))) {
      try {
        addRoot(element.__vue_app__ && element.__vue_app__._instance);
        addRoot(element.__vueParentComponent);
      } catch (_) {}
    }
    const visited = new Set();
    let found = null;
    const inspect = (value) => {
      if (!value || typeof value !== 'object' || found) return;
      const candidates = [value.table, value.game && value.game.table, value.$ && value.$.table, value.$ && value.$.game && value.$.game.table, value.$refs && value.$refs.game && value.$refs.game.table];
      try {
        for (const key of Object.keys(value)) {
          const nested = value[key];
          if (!nested || typeof nested !== 'object') continue;
          candidates.push(nested, nested.table, nested.game && nested.game.table);
        }
      } catch (_) {}
      for (const candidate of candidates) {
        if (candidate && candidate.columnContainers) { found = candidate; return; }
      }
    };
    const walkVNode = (vnode, walkInstance) => {
      if (!vnode || found) return;
      if (vnode.component) walkInstance(vnode.component);
      if (Array.isArray(vnode.children)) for (const child of vnode.children) walkVNode(child, walkInstance);
    };
    const walkInstance = (instance) => {
      if (!instance || found || visited.has(instance)) return;
      visited.add(instance);
      inspect(instance.proxy);
      inspect(instance.ctx);
      inspect(instance.data);
      inspect(instance.setupState);
      if (found) return;
      walkVNode(instance.subTree, walkInstance);
    };
    roots.forEach(walkInstance);
    return { table: found, vueRoots: roots.length };
  };
  const cardRank = (card) => {
    const values = [card && card.cardName, card && card.rank, card && card.value, card && card.name, card && card.id];
    for (const value of values) {
      if (typeof value === 'number') {
        if (value === 14 || value === 1) return 'A';
        if (value === 11) return 'J';
        if (value === 12) return 'Q';
        if (value === 13) return 'K';
        if (value >= 2 && value <= 10) return String(value);
      }
      const text = String(value == null ? '' : value).trim();
      const match = text.match(/(?:^|[^A-Z0-9])(10|[2-9]|A|J|Q|K|T|ACE|KING|QUEEN|JACK)(?:$|[^A-Z0-9])/i);
      if (match) {
        const rank = match[1].toUpperCase();
        return ({ ACE: 'A', KING: 'K', QUEEN: 'Q', JACK: 'J', T: 'A' })[rank] || rank;
      }
    }
    return '';
  };
  const cardSuit = (card) => {
    const value = card && card.suit;
    if (typeof value === 'number') return ({ 0: 'S', 1: 'C', 2: 'D', 3: 'H' })[value] || '';
    const text = String(value == null ? '' : value).toLowerCase();
    if (/spade|♠|\bs\b/.test(text)) return 'S';
    if (/club|♣|\bc\b/.test(text)) return 'C';
    if (/diamond|♦|\bd\b/.test(text)) return 'D';
    if (/heart|♥|\bh\b/.test(text)) return 'H';
    const raw = [card && card.cardName, card && card.name, card && card.id].map(String).join(' ');
    const code = raw.match(/(?:^|[^A-Z0-9])(10|[A2-9JQKT])[_ -]?([CDHS])(?:$|[^A-Z0-9])/i);
    return code ? code[2].toUpperCase() : '';
  };
  const cardFaceUp = (card, container) => {
    if (!card) return null;
    if (container && Array.isArray(container.tempOpenCards) && container.tempOpenCards.includes(card)) return true;
    if (container && Array.isArray(container.tempClosedCards) && container.tempClosedCards.includes(card)) return false;
    const objects = [card, card.sprite, card.cardSprite, card.sprite && card.sprite.cardSprite].filter(Boolean);
    for (const object of objects) {
      for (const key of Object.keys(object)) {
        const value = object[key];
        if (!/state|status|side|face/i.test(key)) continue;
        if (typeof value === 'number' && (value === 20 || value === 37)) return value === 37;
        if (typeof value === 'string') {
          if (/closed|back|down/i.test(value)) return false;
          if (/opened|open|front|up/i.test(value)) return true;
        }
      }
      const children = Array.isArray(object.children) ? object.children : [];
      const front = children.find((child) => /frontSide/i.test(String(child && (child.name || child.label || child.key || ''))));
      const back = children.find((child) => /backSide/i.test(String(child && (child.name || child.label || child.key || ''))));
      if (front && typeof front.visible === 'boolean') return front.visible;
      if (back && typeof back.visible === 'boolean') return !back.visible;
    }
    const key = String(card.key || '');
    if (/frontSide/i.test(key)) return true;
    if (/backSide/i.test(key)) return false;
    return null;
  };
  const readRuntimeBoard = () => {
    const result = findLiveTable();
    const table = result.table;
    if (!table) {
      reportDiagnostic(result.vueRoots > 0 ? 'vue-root-found' : 'vue-root-not-found');
      return null;
    }
    reportDiagnostic('game-table-found');
    const valuesOf = (collection) => Array.isArray(collection) ? collection : (collection instanceof Map ? Array.from(collection.values()) : Object.values(collection || {}));
    const columns = valuesOf(table.columnContainers);
    if (!columns.length) return null;
    reportDiagnostic('game-columns-found');
    const cards = [];
    const appendContainer = (container, slotPrefix) => {
      if (!container || typeof container.getCards !== 'function') return;
      let pile = [];
      try { pile = container.getCards(); } catch (_) { return; }
      if (!Array.isArray(pile)) return;
      pile.forEach((card, index) => {
        const faceUp = cardFaceUp(card, container);
        const rank = faceUp === true ? cardRank(card) : '';
        const suit = faceUp === true ? cardSuit(card) : '';
        const code = faceUp === false ? 'BACK' : (rank && suit ? rank + suit : 'UNKNOWN');
        cards.push({
          code,
          faceUp: faceUp === true && !!(rank && suit),
          slot: slotPrefix + ':' + String(index + 1).padStart(2, '0')
        });
      });
    };
    columns.slice(0, 7).forEach((column, index) => appendContainer(column, 'tableau:' + (index + 1)));
    const houses = valuesOf(table.houseContainers);
    houses.forEach((container, index) => appendContainer(container, 'foundation:' + (index + 1)));
    appendContainer(table.deckContainer, 'deck');
    appendContainer(table.baseContainer, 'base');
    if (!cards.length) { reportDiagnostic('game-cards-unreadable'); return null; }
    reportDiagnostic('game-cards-found');
    const signature = cards.map((card) => card.slot + '=' + card.code + (card.faceUp ? ':UP' : ':DOWN')).join('|');
    return { cards, signature };
  };
  const captureBoard = () => {
    if (!started) return;
    const runtimeSnapshot = readRuntimeBoard();
    if (runtimeSnapshot && runtimeSnapshot.cards.length) {
      const runtimeSignature = 'runtime|' + runtimeSnapshot.signature;
      if (runtimeSignature !== lastBoardSignature) {
        lastBoardSignature = runtimeSignature;
        return send('board', { label: JSON.stringify({ cards: runtimeSnapshot.cards, signature: runtimeSignature }) });
      }
      return;
    }
    const canvas = document.querySelector('canvas.solitaire__canvas');
    if (canvas) reportDiagnostic('solitaire-canvas-found');
    const selector = '[data-card],[data-rank],[class*="card" i],[aria-label*="card" i],img[src*="card" i]';
    const rawNodes = Array.from(document.querySelectorAll(selector)).filter((node) => node instanceof HTMLElement);
    const candidates = [];
    const seenElements = new Set();
    for (const node of rawNodes) {
      const root = node.closest('[data-card],[class*="card" i],[aria-label*="card" i]') || node;
      if (!(root instanceof HTMLElement) || seenElements.has(root)) continue;
      seenElements.add(root);
      const rect = root.getBoundingClientRect();
      if (rect.width < 12 || rect.height < 18 || rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) continue;
      const descendants = Array.from(root.querySelectorAll('img,[data-rank],[data-suit]'));
      const raw = [
        root.getAttribute('aria-label'), root.getAttribute('title'), root.getAttribute('data-card'),
        root.getAttribute('data-value'), root.getAttribute('data-rank'), root.getAttribute('data-suit'),
        root.getAttribute('alt'), root.getAttribute('src'), root.className, root.textContent,
        ...descendants.flatMap((item) => [
          item.getAttribute('aria-label'), item.getAttribute('alt'), item.getAttribute('title'),
          item.getAttribute('src'), item.getAttribute('data-rank'), item.getAttribute('data-suit')
        ])
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const code = cardCodeOf(raw);
      const faceDown = /back|covered|hidden|face[\s_-]*down|card[\s_-]*back/i.test(raw);
      if (!code && !faceDown && !/card/i.test(raw)) continue;
      candidates.push({ root, rect, raw, code: faceDown ? 'BACK' : (code || 'UNKNOWN'), faceUp: !faceDown });
    }
    if (!candidates.length) return;

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
        cards.push({ code: item.faceUp ? item.code : 'BACK', faceUp: item.faceUp, slot });
      }
    }
    cards.sort((a, b) => a.slot.localeCompare(b.slot) || a.code.localeCompare(b.code));
    const signature = cards.map((card) => card.slot + '=' + card.code + (card.faceUp ? ':UP' : ':DOWN')).join('|');
    if (!signature || signature === lastBoardSignature) return;
    lastBoardSignature = signature;
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
  // Game buttons and their text have no control meaning in GAME.
  // While a session is active, capture only genuine mouse input as data.
  document.addEventListener('click', (event) => {
    if (!started || !event.isTrusted) return;
    const cardLabel = cardLabelOf(event.target);
    const label = cardLabel ? 'Klik ' + cardLabel : 'Klik area permainan';
    const input = { x: event.clientX, y: event.clientY, button: event.button, label };
    if (Date.now() >= suppressClickUntil) {
      void send('click', input).then(() => scheduleBoardCapture(350));
    }
  }, true);
  document.addEventListener('pointerdown', (event) => {
    if (!started) return;
    const target = event.target;
    if (event.button === 0) {
      dragStart = { x: event.clientX, y: event.clientY, card: cardLabelOf(target) };
      return;
    }
    const control = target instanceof Element ? target.closest('button,[role="button"],a,[tabindex]') : null;
    void send('click', { x: event.clientX, y: event.clientY, button: event.button, label: control ? labelOf(control).slice(0, 120) : 'Klik kanan area permainan' });
  }, { capture: true, passive: true });
  document.addEventListener('pointerup', (event) => {
    if (!started || event.button !== 0 || !dragStart) return;
    const source = dragStart;
    dragStart = null;
    if (Math.hypot(event.clientX - source.x, event.clientY - source.y) < 7) return;
    const destination = cardLabelOf(event.target) || 'posisi tujuan';
    suppressClickUntil = Date.now() + 800;
    const label = 'Pindahkan ' + (source.card || 'kartu/objek') + ' ke ' + destination;
    void send('click', { x: event.clientX, y: event.clientY, button: 0, label })
      .then(() => window.setTimeout(captureBoard, 350));
  }, { capture: true, passive: true });
  document.addEventListener('pointermove', (event) => {
    if (!started) return;
    if (!reportedMouseCapture) { reportedMouseCapture = true; reportDiagnostic('mouse-captured'); }
    const now = performance.now();
    if (now - lastMoveAt < 35 || (Math.abs(event.clientX - lastX) < 2 && Math.abs(event.clientY - lastY) < 2)) return;
    lastMoveAt = now; lastX = event.clientX; lastY = event.clientY;
    void send('move', { x: event.clientX, y: event.clientY });
  }, { capture: true, passive: true });
})();
"#;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Keep WebView2 cookies, local storage, and IndexedDB in a stable,
            // per-user application-data directory shared by all app versions.
            let profile_dir = app.path().app_data_dir()?.join("browser-profile");
            std::fs::create_dir_all(&profile_dir)?;

            let window = app
                .get_window("main")
                .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Jendela utama GAME tidak ditemukan."))?;
            let start_url = url::Url::parse("https://1xlite-6487.com/en/games/solitaire")?;
            let browser = WebviewBuilder::new(
                "game-browser",
                WebviewUrl::External(start_url),
            )
            .data_directory(profile_dir)
            .initialization_script_for_all_frames(MOUSE_RECORDING_SCRIPT);

            window.add_child(
                browser,
                tauri::LogicalPosition::new(0.0, 0.0),
                tauri::LogicalSize::new(1.0, 1.0),
            )?;
            Ok(())
        })
        .on_page_load(|webview, _payload| {
            if webview.label() == "game-browser" {
                if let Ok(url) = webview.url() {
                    let _ = webview.app_handle().emit("browser-url-changed", url.to_string());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            browser_navigate,
            browser_start_recording,
            browser_back,
            browser_forward,
            browser_reload,
            browser_set_bounds,
            browser_set_visible,
            recording_event,
            recording_diagnostic
        ])
        .run(tauri::generate_context!())
        .expect("Gagal menjalankan GAME Desktop");
}
