use std::env;
use std::path::PathBuf;

fn main() {
    enforce_windows_release_ffmpeg_bundle();
    tauri_build::build()
}

fn enforce_windows_release_ffmpeg_bundle() {
    let target = env::var("TARGET").unwrap_or_default();
    let profile = env::var("PROFILE").unwrap_or_default();
    let nvenc_enabled = env::var_os("CARGO_FEATURE_NATIVE_NVENC").is_some();

    if !target.contains("windows") || profile != "release" || !nvenc_enabled {
        return;
    }

    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let ffmpeg_path = PathBuf::from(manifest_dir).join("bin").join("ffmpeg.exe");

    if !ffmpeg_path.is_file() {
        panic!(
            "missing bundled ffmpeg for Windows release NVENC build: expected {}. Place ffmpeg.exe there (with h264_nvenc support) before running tauri build.",
            ffmpeg_path.display()
        );
    }
}
