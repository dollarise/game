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
    let current = webview.url().map_err(|error| error.to_string())?;
    let page = url::Url::parse(&page_url).map_err(|error| error.to_string())?;
    let allowed = |parsed: &url::Url| {
        parsed.scheme() == "https"
            && parsed.host_str() == Some("1xlite-6487.com")
            && parsed.path().starts_with("/en/games/solitaire")
    };
    if !allowed(&current) || !allowed(&page) {
        return Err("Perekaman hanya diizinkan pada halaman Solitaire yang ditentukan.".to_string());
    }
    match event_type.as_str() {
        "start" => app.emit("recording-auto-start", ()).map_err(|error| error.to_string()),
        "move" | "click" => app.emit("recording-input", RecordingInput {
            kind: event_type,
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
  if (window.top !== window || location.hostname !== '1xlite-6487.com' ||
      !location.pathname.startsWith('/en/games/solitaire') ||
      window.__GAME_MOUSE_RECORDING_INSTALLED__) return;
  window.__GAME_MOUSE_RECORDING_INSTALLED__ = true;
  const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
  if (typeof invoke !== 'function') return;
  let started = false;
  let lastMoveAt = 0;
  let lastX = -10000;
  let lastY = -10000;
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
      element.getAttribute('class'),
      element.className && typeof element.className === 'string' ? element.className : ''
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  };
  const isStartControl = (target) => {
    if (!(target instanceof Element)) return false;
    const control = target.closest('button,[role="button"],a,[tabindex]');
    if (!control) return false;
    const description = (labelOf(control) + ' ' + labelOf(control.querySelector('svg'))).toLowerCase();
    return /\b(play|start|new game|play now)\b/.test(description);
  };
  document.addEventListener('click', (event) => {
    const target = event.target;
    const control = target instanceof Element ? target.closest('button,[role="button"],a,[tabindex]') : null;
    const label = control ? labelOf(control).slice(0, 120) : '';
    if (isStartControl(target)) {
      started = true;
      void send('start', { x: event.clientX, y: event.clientY, button: event.button, label })
        .then(() => send('click', { x: event.clientX, y: event.clientY, button: event.button, label }));
      return;
    }
    if (started) void send('click', { x: event.clientX, y: event.clientY, button: event.button, label });
  }, true);
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
            .initialization_script(MOUSE_RECORDING_SCRIPT);

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
