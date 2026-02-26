#[cfg(target_os = "windows")]
mod session;
#[cfg(target_os = "windows")]
mod target;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "windows")]
pub use windows::{list_dxgi_monitors, run_dxgi_capture_loop};

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
pub fn list_dxgi_monitors(
) -> Result<Vec<crate::capture::windows_capture::NativeCaptureSource>, String> {
    Ok(Vec::new())
}
