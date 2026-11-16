fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "browser_navigate",
                "browser_back",
                "browser_forward",
                "browser_reload",
                "browser_set_bounds",
                "browser_set_visible",
                "recording_event",
            ]),
        ),
    )
    .expect("Gagal membangun manifest izin Tauri");
}
