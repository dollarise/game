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
  window.__GAME_MOUSE_RECORDING_INSTALLED__ = true;
  if (!window.__TAURI_INTERNALS__ || typeof window.__TAURI_INTERNALS__.invoke !== 'function') return;
  const invoke = (...args) => window.__TAURI_INTERNALS__.invoke(...args);
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
    const match = description.match(/(?:^|\\b)(ace|king|queen|jack|10|[2-9]|[AJQK])\\s*(?:of\\s*)?(spades?|hearts?|diamonds?|clubs?|♠|♥|♦|♣)(?:\\b|$)/i);
    return match ? 'kartu ' + match[0].trim() : 'kartu (identitas belum terbaca)';
  };
  const isStartControl = (target) => {
    if (!(target instanceof Element)) return false;
    const control = target.closest('button,[role="button"],a,[tabindex],[class*="play"],[class*="start"]');
    if (!control) return false;
    const description = (labelOf(control) + ' ' + labelOf(control.querySelector('svg')) + ' ' + labelOf(control.querySelector('img'))).toLowerCase();
    return /\b(play|start|new game|play now)\b/.test(description);
  };
  const isAutoBuildControl = (target) => {
    if (!(target instanceof Element)) return false;
    const control = target.closest('button,[role="button"],a,[tabindex]');
    if (!control) return false;
    const description = (labelOf(control) + ' ' + labelOf(control.querySelector('svg')) + ' ' + labelOf(control.querySelector('img'))).toLowerCase();
    return /\bauto\s*build\b/.test(description);
  };
  const captureBoard = () => {
    if (!started) return;
    const nodes = Array.from(document.querySelectorAll('[class*="card"],[data-card],[data-testid*="card"],[aria-label*="card" i]'));
    const cards = [];
    const seen = new Set();
    const rankSuit = /(?:^|\b)(10|[2-9]|[AJQK])\s*(?:of\s*)?(♠|♥|♦|♣|spades?|hearts?|diamonds?|clubs?)(?:\b|$)/i;
    const rankOnly = /\b(ace|king|queen|jack|10|[2-9])\s+of\s+(spades?|hearts?|diamonds?|clubs?)\b/i;
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 12 || rect.height < 18 || rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) continue;
      const raw = [node.getAttribute('aria-label'), node.getAttribute('title'), node.getAttribute('data-card'), node.getAttribute('data-value'), node.getAttribute('alt'), node.textContent, node.className].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const match = raw.match(rankSuit) || raw.match(rankOnly);
      const faceUp = !!match;
      const back = /back|covered|hidden|face-down/i.test(raw);
      if (!faceUp && !back && !/card/i.test(raw)) continue;
      const slot = Math.round(rect.left / Math.max(1, innerWidth) * 100) + ':' + Math.round(rect.top / Math.max(1, innerHeight) * 100);
      const key = slot + ':' + raw.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      let code = 'UNKNOWN';
      if (match) code = match[0].toUpperCase().replace(/\s+OF\s+/,'_');
      else if (back) code = 'BACK';
      cards.push({ code, faceUp, slot });
    }
    if (!cards.length) return;
    cards.sort((a,b) => a.slot.localeCompare(b.slot) || a.code.localeCompare(b.code));
    const signature = cards.map(card => card.slot + '=' + card.code).join('|');
    void send('board', { label: JSON.stringify({ cards, signature }) });
  };
  const isGiveUpControl = (target) => {
    if (!(target instanceof Element)) return false;
    const control = target.closest('button,[role="button"],a,[tabindex]');
    if (!control) return false;
    const description = (labelOf(control) + ' ' + labelOf(control.querySelector('svg')) + ' ' + labelOf(control.querySelector('img'))).toLowerCase();
    return /\bgive\s*up\b|\babandon\b/.test(description);
  };
  document.addEventListener('click', (event) => {
    const target = event.target;
    const control = target instanceof Element ? target.closest('button,[role="button"],a,[tabindex]') : null;
    const cardLabel = cardLabelOf(target);
    const label = cardLabel ? 'Klik ' + cardLabel : control ? labelOf(control).slice(0, 120) : 'Klik area permainan';
    if (isStartControl(target)) {
      started = true;
      void send('start', { x: event.clientX, y: event.clientY, button: event.button, label })
        .then(() => send('click', { x: event.clientX, y: event.clientY, button: event.button, label }))
        .then(() => window.setTimeout(captureBoard, 650));
      return;
    }
    const input = { x: event.clientX, y: event.clientY, button: event.button, label };
    // Give up may be clicked inside a separate game iframe, whose local
    // recording flag was never set by the frame that detected Play/Start.
    // Detect this explicit button click independently of that local flag.
    if (isAutoBuildControl(target)) {
      if (started) void send('click', input).then(() => window.setTimeout(captureBoard, 350));
      started = false;
      void send('auto_build', input);
      return;
    }
    if (isGiveUpControl(target)) {
      if (started) void send('click', input);
      started = false;
      void send('give_up', input);
      return;
    }
    if (started && Date.now() >= suppressClickUntil) void send('click', input);
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
