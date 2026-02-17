mod capture;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(capture::service::NativeCaptureService::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            capture::service::list_native_capture_sources,
            capture::service::native_codec_capabilities,
            capture::service::start_native_capture,
            capture::service::stop_native_capture,
            capture::service::native_capture_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
