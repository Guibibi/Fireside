pub mod capture_v2;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let capture_session = capture_v2::new_shared_session();

    tauri::Builder::default()
        .manage(capture_session)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            capture_v2::enumerate_sources,
            capture_v2::start_capture,
            capture_v2::stop_capture,
            capture_v2::get_capture_state,
            capture_v2::get_capture_metrics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
