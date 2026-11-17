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
fn browser_start_recording(app: AppHandle) -> Result<(), String> {
    let view = browser_view(&app)?;
    let current = view.url().map_err(|error| error.to_string())?;
    let is_solitaire_page = current.scheme() == "https"
        && current.host_str() == Some("1xlite-6487.com")
        && current.path().starts_with("/en/games/solitaire");
    if !is_solitaire_page {
        return Err("Perekaman hanya diizinkan pada halaman Solitaire yang ditentukan.".to_string());
    }
    // Start the React recording session directly; do not depend on the
    // page's injected Tauri bridge to deliver the initial state transition.
    app.emit("recording-auto-start", ()).map_err(|error| error.to_string())?;
    view.eval("window.postMessage({ type: 'GAME_MANUAL_START_RECORDING' }, '*');")
        .map_err(|error| error.to_string())
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
        && current.host_str() == Some("1xlite-6487.com")
        && current.path().starts_with("/en/games/solitaire");
    if !is_solitaire_page {
        return Err("Perekaman hanya diizinkan pada halaman Solitaire yang ditentukan.".to_string());
    }
    let _ = page_url;
    match event_type.as_str() {
        "start" => app.emit("recording-auto-start", ()).map_err(|error| error.to_string()),
        "give_up" => app.emit("recording-auto-stop", ()).map_err(|error| error.to_string()),
        "auto_build" => {
            app.emit("recording-input", RecordingInput { kind: "click".to_string(), x, y, button, label })
                .map_err(|error| error.to_string())?;
            app.emit("recording-auto-complete", ()).map_err(|error| error.to_string())
        },
        "move" | "click" | "board" => app.emit("recording-input", RecordingInput {
            kind: event_type.clone(),
            x,
            y,
            button,
            label,
        }).map_err(|error| error.to_string()),
        _ => Err("Jenis aktivitas rekaman tidak dikenal.".to_string()),
    }
}

const MOUSE_RECORDING_SCRIPT: &str = r#"
(() => {
  const topPath = (() => { try { return window.top.location.pathname; } catch (_) { return ''; } })();
  const isGamePage = location.hostname === '1xlite-6487.com' && location.pathname.startsWith('/en/games/solitaire');
  const isGameEmbed = (() => {
    try { return new URL(document.referrer).hostname === '1xlite-6487.com'; }
    catch (_) { return false; }
  })();
  if ((!isGamePage && !topPath.startsWith('/en/games/solitaire') && !isGameEmbed) ||
      window.__GAME_MOUSE_RECORDING_INSTALLED__) return;
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
  const send = (eventType, data = {}) => invoke('recording_event', {
    eventType,
    x: Number.isFinite(data.x) ? data.x : null,
    y: Number.isFinite(data.y) ? data.y : null,
    button: Number.isInteger(data.button) ? data.button : null,
    pageUrl: location.href,
    label: data.label || null
  }).catch(() => undefined);
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
  const isStartControl = (target) => {
    if (!(target instanceof Element)) return false;
    // The game uses nested div/SVG controls in some layouts. Inspect the
    // clicked element and several ancestors instead of relying on button tags.
    let node = target;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const description = [
        labelOf(node),
        labelOf(node.querySelector && node.querySelector('svg')),
        labelOf(node.querySelector && node.querySelector('img'))
      ].join(' ').toLowerCase();
      if (/(^|[^a-z])(play|start|new\\s*game|play\\s*now|deal)([^a-z]|$)/i.test(description)) return true;
    }
    return false;
  };
  const isAutoBuildControl = (target) => {
    if (!(target instanceof Element)) return false;
    const control = target.closest('button,[role="button"],a,[tabindex]');
    if (!control) return false;
    const description = (labelOf(control) + ' ' + labelOf(control.querySelector('svg')) + ' ' + labelOf(control.querySelector('img'))).toLowerCase();
    return /\bauto\s*build\b/.test(description);
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
  const captureBoard = () => {
    if (!started) return;
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
  // Manual fallback from the GAME toolbar, relayed into nested game frames.
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'GAME_MANUAL_START_RECORDING') return;
    if (!started) {
      started = true;
      startBoardObserver();
      scheduleBoardCapture(350);
    }
    for (const frame of Array.from(document.querySelectorAll('iframe'))) {
      try { frame.contentWindow?.postMessage({ type: 'GAME_MANUAL_START_RECORDING' }, '*'); } catch (_) {}
    }
  });
  const isGiveUpControl = (target) => {
    if (!(target instanceof Element)) return false;
    const control = target.closest('button,[role="button"],a,[tabindex]');
    if (!control) return false;
    const description = (labelOf(control) + ' ' + labelOf(control.querySelector('svg')) + ' ' + labelOf(control.querySelector('img'))).toLowerCase();
    return /\bgive\s*up\b|\babandon\b/.test(description);
  };
  // Detect the launch action on pointer press as well as click. This starts
  // the session even when the embedded game's UI suppresses its click event.
  document.addEventListener('pointerdown', (event) => {
    if (started || !isStartControl(event.target)) return;
    started = true;
    startBoardObserver();
    const control = event.target instanceof Element
      ? event.target.closest('button,[role="button"],a,[tabindex]') || event.target
      : null;
    const label = control ? labelOf(control).slice(0, 120) : 'Play / Start Game';
    void send('start', { x: event.clientX, y: event.clientY, button: event.button, label });
  }, true);
  document.addEventListener('click', (event) => {
    const target = event.target;
    const control = target instanceof Element ? target.closest('button,[role="button"],a,[tabindex]') : null;
    const cardLabel = cardLabelOf(target);
    const label = cardLabel ? 'Klik ' + cardLabel : control ? labelOf(control).slice(0, 120) : 'Klik area permainan';
    if (isStartControl(target)) {
      if (!started) {
        started = true;
        startBoardObserver();
        void send('start', { x: event.clientX, y: event.clientY, button: event.button, label })
          .then(() => send('click', { x: event.clientX, y: event.clientY, button: event.button, label }))
          .then(() => scheduleBoardCapture(650));
      } else {
        void send('click', { x: event.clientX, y: event.clientY, button: event.button, label })
          .then(() => scheduleBoardCapture(650));
      }
      return;
    }
    const input = { x: event.clientX, y: event.clientY, button: event.button, label };
    // Give up may be clicked inside a separate game iframe, whose local
    // recording flag was never set by the frame that detected Play/Start.
    // Detect this explicit button click independently of that local flag.
    if (isAutoBuildControl(target)) {
      // Auto Build can change the final board immediately. Capture and deliver
      // that final snapshot before notifying the UI to save/stop the session.
      if (started) {
        void send('click', input)
          .then(() => new Promise((resolve) => window.setTimeout(resolve, 350)))
          .then(() => captureBoard())
          .then(() => {
            started = false;
            stopBoardObserver();
            return send('auto_build', input);
          });
      } else {
        void send('auto_build', input);
      }
      return;
    }
    if (isGiveUpControl(target)) {
      if (started) void send('click', input);
      started = false;
      stopBoardObserver();
      void send('give_up', input);
      return;
    }
    if (started && Date.now() >= suppressClickUntil) void send('click', input).then(() => scheduleBoardCapture(350));
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
            recording_event
        ])
        .run(tauri::generate_context!())
        .expect("Gagal menjalankan GAME Desktop");
}
