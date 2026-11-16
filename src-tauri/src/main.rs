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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Keep WebView2 cookies, local storage, and IndexedDB in a stable,
            // per-user application-data directory shared by all app versions.
            let profile_dir = app.path().app_data_dir()?.join("browser-profile");
            std::fs::create_dir_all(&profile_dir)?;

            let window = app
                .get_webview_window("main")
                .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Jendela utama GAME tidak ditemukan."))?;
            let start_url = url::Url::parse("https://1xlite-6487.com/")?;
            let browser = WebviewBuilder::new(
                "game-browser",
                WebviewUrl::External(start_url),
            )
            .data_directory(profile_dir);

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
            browser_reload
        ])
        .run(tauri::generate_context!())
        .expect("Gagal menjalankan GAME Desktop");
}
