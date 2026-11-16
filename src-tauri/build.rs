fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["recording_event"]),
        ),
    )
    .expect("Gagal membangun manifest izin Tauri");
}
