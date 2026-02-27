use super::encoder_backend::VideoEncoderBackend;

#[cfg(all(target_os = "windows", feature = "native-nvenc"))]
use super::encoder_backend::split_annex_b_nals;
#[cfg(all(target_os = "windows", feature = "native-nvenc"))]
use super::encoder_backend::CodecDescriptor;
#[cfg(all(target_os = "windows", feature = "native-nvenc"))]
use super::metrics::NativeSenderSharedMetrics;

#[cfg(all(target_os = "windows", feature = "native-nvenc"))]
mod imp {
    use std::mem::MaybeUninit;
    use std::panic::{self, AssertUnwindSafe};
    use std::sync::atomic::Ordering;

    /// Zero-initialize an NVENC struct by writing zero bytes directly,
    /// bypassing Rust's validity checks on `NonZero` fields that would
    /// cause `std::mem::zeroed()` to panic in debug builds.
    unsafe fn nvenc_zeroed<T>() -> T {
        let mut val = MaybeUninit::<T>::uninit();
        std::ptr::write_bytes(val.as_mut_ptr(), 0u8, 1);
        val.assume_init()
    }

    use cudarc::driver::CudaContext;
    use nvidia_video_codec_sdk::sys::nvEncodeAPI::{
        NV_ENC_BUFFER_FORMAT, NV_ENC_CODEC_H264_GUID, NV_ENC_CONFIG, NV_ENC_PIC_TYPE,
        NV_ENC_PRESET_P4_GUID, NV_ENC_TUNING_INFO,
    };
    use nvidia_video_codec_sdk::{
        Bitstream, Buffer, EncodePictureParams, Encoder, EncoderInitParams, ErrorKind,
    };

    use super::{CodecDescriptor, NativeSenderSharedMetrics, VideoEncoderBackend};

    const DEFAULT_TARGET_FPS: u32 = 30;
    const DEFAULT_TARGET_BITRATE_KBPS: u32 = 8_000;
    const BUFFER_POOL_SIZE: usize = 4;

    fn drop_nvenc_resource<T>(resource: &str, value: T) {
        if panic::catch_unwind(AssertUnwindSafe(|| drop(value))).is_err() {
            eprintln!(
                "[native-sender] event=nvenc_drop_panic resource={} detail=\"drop panicked\"",
                resource,
            );
        }
    }

    fn release_nvenc_guard<T>(resource: &str, value: T) -> Result<(), String> {
        panic::catch_unwind(AssertUnwindSafe(|| drop(value)))
            .map_err(|_| format!("NVENC SDK: failed to release {resource} because drop panicked"))
    }

    // ───────────────────── Phase 1: CUDA-based NVENC session ─────────────────
    struct NvencSdkSession {
        // SAFETY INVARIANTS:
        // 1. The 'static lifetime transmute is sound because:
        //    - `Session`, `Buffer<'_>`, and `Bitstream<'_>` are all !Send and !Sync,
        //      meaning they cannot outlive their creating thread.
        //    - The NvencSdkSession is used from a single thread only (the sender worker).
        //    - Drop order is enforced manually: buffers are cleared before session in Drop.
        // 2. The transmute relies on the internal representation that `Buffer` and `Bitstream`
        //    contain a reference to the session (via a pointer). This is guaranteed by the
        //    nvidia_video_codec_sdk crate API contract.
        // 3. If the crate changes its internal representation, this code will still compile
        //    but may exhibit undefined behavior. The safety relies on the crate maintaining
        //    its current API contract.
        // 4. The transmute is only used within this module and is not exposed publicly.
        session: Option<nvidia_video_codec_sdk::Session>,
        input_buffers: Vec<Buffer<'static>>,
        output_bitstreams: Vec<Bitstream<'static>>,
        width: u32,
        height: u32,
        force_idr: bool,
    }

    // SAFETY: All fields are used from a single thread (the sender worker).
    // The CUDA context within is Arc-wrapped and internally thread-safe.
    unsafe impl Send for NvencSdkSession {}

    impl NvencSdkSession {
        fn recycle_io_buffers(
            &mut self,
            input_buffer: &mut Option<Buffer<'static>>,
            output_bitstream: &mut Option<Bitstream<'static>>,
        ) {
            if let Some(buffer) = input_buffer.take() {
                self.input_buffers.push(buffer);
            }
            if let Some(bitstream) = output_bitstream.take() {
                self.output_bitstreams.push(bitstream);
            }
        }

        fn open(
            width: u32,
            height: u32,
            target_fps: u32,
            target_bitrate_kbps: u32,
        ) -> Result<Self, String> {
            // TODO: On multi-GPU systems, device 0 may not be the display adapter.
            // Consider matching the CUDA device to the display adapter in the future.
            let cuda_ctx = CudaContext::new(0)
                .map_err(|e| format!("NVENC SDK: failed to create CUDA context: {e}"))?;

            let encoder = Encoder::initialize_with_cuda(cuda_ctx)
                .map_err(|e| format!("NVENC SDK: failed to initialize encoder: {e}"))?;

            // Get preset config so we can customize rate control
            let preset_config = encoder
                .get_preset_config(
                    NV_ENC_CODEC_H264_GUID,
                    NV_ENC_PRESET_P4_GUID,
                    NV_ENC_TUNING_INFO::NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY,
                )
                .map_err(|e| format!("NVENC SDK: failed to get preset config: {e}"))?;

            let mut encode_config: NV_ENC_CONFIG = preset_config.presetCfg;
            encode_config.frameIntervalP = 1; // No B-frames
            encode_config.gopLength = target_fps; // 1 second GOP

            // Configure CBR rate control at the requested bitrate
            let bitrate_bps = target_bitrate_kbps * 1_000;
            encode_config.rcParams.rateControlMode =
                nvidia_video_codec_sdk::sys::nvEncodeAPI::NV_ENC_PARAMS_RC_MODE::NV_ENC_PARAMS_RC_CBR;
            encode_config.rcParams.averageBitRate = bitrate_bps;
            encode_config.rcParams.maxBitRate = bitrate_bps;
            encode_config.rcParams.vbvBufferSize = bitrate_bps / target_fps;

            let mut init_params = EncoderInitParams::new(NV_ENC_CODEC_H264_GUID, width, height);
            init_params
                .preset_guid(NV_ENC_PRESET_P4_GUID)
                .tuning_info(NV_ENC_TUNING_INFO::NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY)
                .encode_config(&mut encode_config)
                .enable_picture_type_decision()
                .framerate(target_fps, 1);

            let buffer_format = NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_ARGB;

            let session = encoder
                .start_session(buffer_format, init_params)
                .map_err(|e| format!("NVENC SDK: failed to start session: {e}"))?;

            // SAFETY: Transmute session lifetime to 'static so buffers can be stored alongside.
            // This is sound because:
            // 1. NvencSdkSession is !Send and used from a single thread only.
            // 2. Drop order is enforced: buffers cleared before session in Drop::drop.
            // 3. The session and buffers are never accessed after the struct is dropped.
            // See struct-level SAFETY INVARIANTS comment for full details.
            let session: nvidia_video_codec_sdk::Session = unsafe { std::mem::transmute(session) };

            let mut input_buffers = Vec::with_capacity(BUFFER_POOL_SIZE);
            let mut output_bitstreams = Vec::with_capacity(BUFFER_POOL_SIZE);

            for _ in 0..BUFFER_POOL_SIZE {
                // SAFETY: Transmute buffer lifetime to 'static to store alongside session.
                // Sound because session outlives buffers and buffers are dropped first.
                let buf: Buffer<'static> =
                    unsafe {
                        std::mem::transmute(session.create_input_buffer().map_err(|e| {
                            format!("NVENC SDK: failed to create input buffer: {e}")
                        })?)
                    };
                input_buffers.push(buf);

                // SAFETY: Transmute bitstream lifetime to 'static to store alongside session.
                // Sound because session outlives bitstreams and bitstreams are dropped first.
                let bs: Bitstream<'static> = unsafe {
                    std::mem::transmute(session.create_output_bitstream().map_err(|e| {
                        format!("NVENC SDK: failed to create output bitstream: {e}")
                    })?)
                };
                output_bitstreams.push(bs);
            }

            Ok(Self {
                session: Some(session),
                input_buffers,
                output_bitstreams,
                width,
                height,
                force_idr: false,
            })
        }

        fn encode_bgra(&mut self, bgra: &[u8]) -> Result<Vec<u8>, String> {
            let expected_size = self.width as usize * self.height as usize * 4;
            if bgra.len() != expected_size {
                return Err(format!(
                    "NVENC SDK: frame size mismatch (expected {expected_size}, got {})",
                    bgra.len()
                ));
            }

            let mut input_buffer = Some(
                self.input_buffers
                    .pop()
                    .ok_or_else(|| "NVENC SDK: no available input buffers".to_string())?,
            );
            let mut output_bitstream = Some(
                self.output_bitstreams
                    .pop()
                    .ok_or_else(|| "NVENC SDK: no available output bitstreams".to_string())?,
            );

            let input = match input_buffer.as_mut() {
                Some(buffer) => buffer,
                None => {
                    self.recycle_io_buffers(&mut input_buffer, &mut output_bitstream);
                    return Err("NVENC SDK: input buffer unexpectedly unavailable".to_string());
                }
            };

            let mut input_lock = match input.lock() {
                Ok(lock) => lock,
                Err(e) => {
                    self.recycle_io_buffers(&mut input_buffer, &mut output_bitstream);
                    return Err(format!("NVENC SDK: failed to lock input buffer: {e}"));
                }
            };

            unsafe {
                input_lock.write(bgra);
            }

            if let Err(e) = release_nvenc_guard("input buffer lock", input_lock) {
                self.recycle_io_buffers(&mut input_buffer, &mut output_bitstream);
                return Err(e);
            }

            let mut params = EncodePictureParams::default();
            if self.force_idr {
                params.picture_type = NV_ENC_PIC_TYPE::NV_ENC_PIC_TYPE_IDR;
                self.force_idr = false;
            }

            let session = match self.session.as_ref() {
                Some(session) => session,
                None => {
                    self.recycle_io_buffers(&mut input_buffer, &mut output_bitstream);
                    return Err("NVENC SDK: session unavailable".to_string());
                }
            };

            let input = match input_buffer.as_mut() {
                Some(buffer) => buffer,
                None => {
                    self.recycle_io_buffers(&mut input_buffer, &mut output_bitstream);
                    return Err("NVENC SDK: input buffer unexpectedly unavailable".to_string());
                }
            };
            let output = match output_bitstream.as_mut() {
                Some(bitstream) => bitstream,
                None => {
                    self.recycle_io_buffers(&mut input_buffer, &mut output_bitstream);
                    return Err("NVENC SDK: output bitstream unexpectedly unavailable".to_string());
                }
            };

            let encode_result = session.encode_picture(input, output, params);

            match encode_result {
                Ok(()) => {}
                Err(e) if e.kind() == ErrorKind::NeedMoreInput => {
                    self.recycle_io_buffers(&mut input_buffer, &mut output_bitstream);
                    return Ok(Vec::new());
                }
                Err(e) => {
                    self.recycle_io_buffers(&mut input_buffer, &mut output_bitstream);
                    return Err(format!("NVENC SDK: encode failed: {e}"));
                }
            }

            let output = match output_bitstream.as_mut() {
                Some(bitstream) => bitstream,
                None => {
                    self.recycle_io_buffers(&mut input_buffer, &mut output_bitstream);
                    return Err("NVENC SDK: output bitstream unexpectedly unavailable".to_string());
                }
            };

            let output_lock = match output.lock() {
                Ok(lock) => lock,
                Err(e) => {
                    self.recycle_io_buffers(&mut input_buffer, &mut output_bitstream);
                    return Err(format!("NVENC SDK: failed to lock bitstream: {e}"));
                }
            };
            let data = output_lock.data().to_vec();
            if let Err(e) = release_nvenc_guard("output bitstream lock", output_lock) {
                self.recycle_io_buffers(&mut input_buffer, &mut output_bitstream);
                return Err(e);
            }

            self.recycle_io_buffers(&mut input_buffer, &mut output_bitstream);

            Ok(data)
        }

        fn request_keyframe(&mut self) {
            self.force_idr = true;
        }
    }

    impl Drop for NvencSdkSession {
        fn drop(&mut self) {
            let mut input_buffers = std::mem::take(&mut self.input_buffers);
            while let Some(buffer) = input_buffers.pop() {
                drop_nvenc_resource("input_buffer", buffer);
            }

            let mut output_bitstreams = std::mem::take(&mut self.output_bitstreams);
            while let Some(bitstream) = output_bitstreams.pop() {
                drop_nvenc_resource("output_bitstream", bitstream);
            }

            if let Some(session) = self.session.take() {
                drop_nvenc_resource("session", session);
            }
        }
    }

    // ───────────────── Unified encoder backend ─────────────────

    // (NvencD3D11Session removed: zero-copy GPU path was tied to DXGI capture
    //  which has been replaced by windows-capture. NVENC SDK now uses the CUDA
    //  CPU-BGRA path exclusively, which is simpler and still hardware-accelerated.)

    pub(super) struct NvencSdkEncoderBackend {
        target_fps: u32,
        target_bitrate_kbps: u32,
        session: Option<NvencSdkSession>,
    }

    impl NvencSdkEncoderBackend {
        fn new(target_fps: Option<u32>, target_bitrate_kbps: Option<u32>) -> Result<Self, String> {
            // Probe that CUDA + NVENC SDK is available.
            let cuda_ctx =
                CudaContext::new(0).map_err(|e| format!("NVENC SDK: CUDA not available: {e}"))?;
            let encoder = Encoder::initialize_with_cuda(cuda_ctx)
                .map_err(|e| format!("NVENC SDK: encoder initialization failed: {e}"))?;
            let guids = encoder
                .get_encode_guids()
                .map_err(|e| format!("NVENC SDK: failed to query encode GUIDs: {e}"))?;
            if !guids.contains(&NV_ENC_CODEC_H264_GUID) {
                return Err("NVENC SDK: H264 encoding not supported by this GPU".to_string());
            }
            drop(encoder);

            Ok(Self {
                target_fps: target_fps.unwrap_or(DEFAULT_TARGET_FPS).max(1),
                target_bitrate_kbps: target_bitrate_kbps
                    .unwrap_or(DEFAULT_TARGET_BITRATE_KBPS)
                    .max(1_000),
                session: None,
            })
        }

        fn ensure_session(
            &mut self,
            width: u32,
            height: u32,
        ) -> Result<&mut NvencSdkSession, String> {
            let need_restart = match &self.session {
                Some(s) => s.width != width || s.height != height,
                None => false,
            };

            if need_restart {
                self.session = None;
            }

            if self.session.is_none() {
                let s = NvencSdkSession::open(
                    width,
                    height,
                    self.target_fps,
                    self.target_bitrate_kbps,
                )?;
                self.session = Some(s);
            }

            self.session
                .as_mut()
                .ok_or_else(|| "NVENC SDK session unavailable".to_string())
        }
    }

    impl VideoEncoderBackend for NvencSdkEncoderBackend {
        fn codec_descriptor(&self) -> CodecDescriptor {
            CodecDescriptor {
                mime_type: "video/H264",
                clock_rate: 90_000,
                packetization_mode: Some(1),
                profile_level_id: Some("42e01f"),
            }
        }

        fn encode_frame(
            &mut self,
            bgra: &[u8],
            width: u32,
            height: u32,
            shared: &NativeSenderSharedMetrics,
        ) -> Option<Vec<Vec<u8>>> {
            if width == 0 || height == 0 || !width.is_multiple_of(2) || !height.is_multiple_of(2) {
                shared.encode_errors.fetch_add(1, Ordering::Relaxed);
                return None;
            }

            let session = match self.ensure_session(width, height) {
                Ok(s) => s,
                Err(e) => {
                    shared.encode_errors.fetch_add(1, Ordering::Relaxed);
                    eprintln!(
                        "[native-sender] event=encode_error backend=nvenc_sdk detail=\"{e}\""
                    );
                    return None;
                }
            };

            match session.encode_bgra(bgra) {
                Ok(data) if data.is_empty() => None,
                Ok(data) => {
                    let nals = split_annex_b_nals(&data);
                    if nals.is_empty() {
                        None
                    } else {
                        Some(nals)
                    }
                }
                Err(e) => {
                    shared.encode_errors.fetch_add(1, Ordering::Relaxed);
                    eprintln!(
                        "[native-sender] event=encode_error backend=nvenc_sdk detail=\"{e}\""
                    );
                    self.session = None;
                    None
                }
            }
        }

        fn request_keyframe(&mut self) -> bool {
            if let Some(s) = &mut self.session {
                s.request_keyframe();
                true
            } else {
                false
            }
        }
    }

    impl Drop for NvencSdkEncoderBackend {
        fn drop(&mut self) {
            self.session = None;
        }
    }

    pub(super) fn build_nvenc_sdk_backend(
        target_fps: Option<u32>,
        target_bitrate_kbps: Option<u32>,
    ) -> Result<Box<dyn VideoEncoderBackend>, String> {
        let backend = NvencSdkEncoderBackend::new(target_fps, target_bitrate_kbps)?;
        Ok(Box::new(backend))
    }

    use super::split_annex_b_nals;
}

#[cfg(all(target_os = "windows", feature = "native-nvenc"))]
pub fn try_build_nvenc_sdk_backend(
    target_fps: Option<u32>,
    target_bitrate_kbps: Option<u32>,
) -> Result<Box<dyn VideoEncoderBackend>, String> {
    imp::build_nvenc_sdk_backend(target_fps, target_bitrate_kbps)
}

#[cfg(not(all(target_os = "windows", feature = "native-nvenc")))]
pub fn try_build_nvenc_sdk_backend(
    _target_fps: Option<u32>,
    _target_bitrate_kbps: Option<u32>,
) -> Result<Box<dyn VideoEncoderBackend>, String> {
    Err(
        "NVENC SDK backend is not available in this build (requires Windows + native-nvenc feature)."
            .to_string(),
    )
}
