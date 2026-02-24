// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Allow audio playback without requiring a user gesture in WebView2.
    // Without this, AudioContext and HTMLAudioElement.play() are blocked by
    // Chromium autoplay policy, causing incoming voice chat audio to be silent.
    #[cfg(target_os = "windows")]
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--autoplay-policy=no-user-gesture-required",
    );

    client_lib::run()
}
