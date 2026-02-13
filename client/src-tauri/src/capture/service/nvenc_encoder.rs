use super::encoder_backend::VideoEncoderBackend;

#[cfg(all(target_os = "windows", feature = "native-nvenc"))]
pub fn try_build_nvenc_backend(
    _target_fps: Option<u32>,
    _target_bitrate_kbps: Option<u32>,
) -> Result<Box<dyn VideoEncoderBackend>, String> {
    Err(
        "NVENC backend scaffolding is present, but encoder wiring is not implemented yet."
            .to_string(),
    )
}

#[cfg(not(all(target_os = "windows", feature = "native-nvenc")))]
pub fn try_build_nvenc_backend(
    _target_fps: Option<u32>,
    _target_bitrate_kbps: Option<u32>,
) -> Result<Box<dyn VideoEncoderBackend>, String> {
    Err(
        "NVENC backend is not available in this build (requires Windows + native-nvenc feature)."
            .to_string(),
    )
}
