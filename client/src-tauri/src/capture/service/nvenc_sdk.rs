use super::encoder_backend::VideoEncoderBackend;

#[cfg(all(target_os = "windows", feature = "native-nvenc"))]
use super::encoder_backend::CodecDescriptor;
#[cfg(all(target_os = "windows", feature = "native-nvenc"))]
use super::metrics::NativeSenderSharedMetrics;

#[cfg(all(target_os = "windows", feature = "native-nvenc"))]
mod imp {
    use std::ffi::c_void;
    use std::sync::atomic::Ordering;

    use cudarc::driver::CudaContext;
    use nvidia_video_codec_sdk::sys::nvEncodeAPI::{
        NVENCSTATUS, NV_ENC_BUFFER_FORMAT, NV_ENC_CODEC_H264_GUID, NV_ENC_CONFIG,
        NV_ENC_CREATE_BITSTREAM_BUFFER, NV_ENC_DEVICE_TYPE, NV_ENC_INITIALIZE_PARAMS,
        NV_ENC_INPUT_RESOURCE_TYPE, NV_ENC_LOCK_BITSTREAM, NV_ENC_MAP_INPUT_RESOURCE,
        NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS, NV_ENC_PIC_PARAMS, NV_ENC_PIC_TYPE,
        NV_ENC_PRESET_CONFIG, NV_ENC_PRESET_P4_GUID, NV_ENC_REGISTER_RESOURCE, NV_ENC_TUNING_INFO,
    };
    use nvidia_video_codec_sdk::{
        Bitstream, Buffer, EncodePictureParams, Encoder, EncoderInitParams, ErrorKind, ENCODE_API,
    };

    use super::{CodecDescriptor, NativeSenderSharedMetrics, VideoEncoderBackend};
    use crate::capture::gpu_frame::GpuTextureHandle;
    use crate::capture::service::encoder_backend::GpuEncodeResult;

    const DEFAULT_TARGET_FPS: u32 = 30;
    const DEFAULT_TARGET_BITRATE_KBPS: u32 = 8_000;
    const BUFFER_POOL_SIZE: usize = 4;

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
        session: nvidia_video_codec_sdk::Session,
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
        fn open(
            width: u32,
            height: u32,
            target_fps: u32,
            target_bitrate_kbps: u32,
        ) -> Result<Self, String> {
            // TODO: On multi-GPU systems, we should match the CUDA device to the
            // GPU where the D3D11 capture device resides. Currently using device 0
            // which works for single-GPU setups but may cause issues if the display
            // is on a non-NVIDIA GPU or a different NVIDIA GPU.
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
                session,
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

            let mut input_buffer = self
                .input_buffers
                .pop()
                .ok_or_else(|| "NVENC SDK: no available input buffers".to_string())?;
            let mut output_bitstream = self
                .output_bitstreams
                .pop()
                .ok_or_else(|| "NVENC SDK: no available output bitstreams".to_string())?;

            unsafe {
                input_buffer
                    .lock()
                    .map_err(|e| format!("NVENC SDK: failed to lock input buffer: {e}"))?
                    .write(bgra);
            }

            let mut params = EncodePictureParams::default();
            if self.force_idr {
                params.picture_type = NV_ENC_PIC_TYPE::NV_ENC_PIC_TYPE_IDR;
                self.force_idr = false;
            }

            let encode_result =
                self.session
                    .encode_picture(&mut input_buffer, &mut output_bitstream, params);

            match encode_result {
                Ok(()) => {}
                Err(e) if e.kind() == ErrorKind::NeedMoreInput => {
                    self.input_buffers.push(input_buffer);
                    self.output_bitstreams.push(output_bitstream);
                    return Ok(Vec::new());
                }
                Err(e) => {
                    self.input_buffers.push(input_buffer);
                    self.output_bitstreams.push(output_bitstream);
                    return Err(format!("NVENC SDK: encode failed: {e}"));
                }
            }

            let lock = output_bitstream
                .lock()
                .map_err(|e| format!("NVENC SDK: failed to lock bitstream: {e}"))?;
            let data = lock.data().to_vec();
            drop(lock);

            self.input_buffers.push(input_buffer);
            self.output_bitstreams.push(output_bitstream);

            Ok(data)
        }

        fn request_keyframe(&mut self) {
            self.force_idr = true;
        }
    }

    impl Drop for NvencSdkSession {
        fn drop(&mut self) {
            self.input_buffers.clear();
            self.output_bitstreams.clear();
        }
    }

    // ───────────────── Phase 3: D3D11 zero-copy NVENC session ────────────────

    /// Raw NVENC session opened with a D3D11 device for zero-copy encoding
    /// of GPU-resident textures.
    struct NvencD3D11Session {
        encoder: *mut c_void,
        output_bitstream: *mut c_void,
        width: u32,
        height: u32,
        force_idr: bool,
        /// Cached NVENC resource registration for the current texture.
        /// Avoids per-frame register/unregister overhead. The texture
        /// pointer is stable because DxgiCaptureSession reuses its copy
        /// texture (same COM object across frames).
        registered_texture_ptr: *mut c_void,
        registered_resource: *mut c_void,
    }

    // SAFETY: Used from a single thread (sender worker). The D3D11 device has
    // multithread protection enabled.
    unsafe impl Send for NvencD3D11Session {}

    fn nvenc_status_ok(status: NVENCSTATUS) -> bool {
        status == NVENCSTATUS::NV_ENC_SUCCESS
    }

    impl NvencD3D11Session {
        fn open(
            d3d11_device: *mut c_void,
            width: u32,
            height: u32,
            target_fps: u32,
            target_bitrate_kbps: u32,
        ) -> Result<Self, String> {
            unsafe {
                let api = &*ENCODE_API;

                // Open encoder session with D3D11 device
                let mut open_params: NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS = std::mem::zeroed();
                open_params.version =
                    nvidia_video_codec_sdk::sys::nvEncodeAPI::NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS_VER;
                open_params.deviceType = NV_ENC_DEVICE_TYPE::NV_ENC_DEVICE_TYPE_DIRECTX;
                open_params.device = d3d11_device;
                open_params.apiVersion = nvidia_video_codec_sdk::sys::nvEncodeAPI::NVENCAPI_VERSION;

                let mut encoder: *mut c_void = std::ptr::null_mut();
                let status = (api.open_encode_session_ex)(&mut open_params, &mut encoder);
                if !nvenc_status_ok(status) {
                    return Err(format!(
                        "NVENC D3D11: open_encode_session_ex failed: {:?}",
                        status
                    ));
                }

                // Get preset config for H264 baseline
                let mut preset_config: NV_ENC_PRESET_CONFIG = std::mem::zeroed();
                preset_config.version =
                    nvidia_video_codec_sdk::sys::nvEncodeAPI::NV_ENC_PRESET_CONFIG_VER;
                preset_config.presetCfg.version =
                    nvidia_video_codec_sdk::sys::nvEncodeAPI::NV_ENC_CONFIG_VER;

                let status = (api.get_encode_preset_config_ex)(
                    encoder,
                    NV_ENC_CODEC_H264_GUID,
                    NV_ENC_PRESET_P4_GUID,
                    NV_ENC_TUNING_INFO::NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY,
                    &mut preset_config,
                );
                if !nvenc_status_ok(status) {
                    let _ = (api.destroy_encoder)(encoder);
                    return Err(format!(
                        "NVENC D3D11: get_preset_config_ex failed: {:?}",
                        status
                    ));
                }

                let mut encode_config = preset_config.presetCfg;
                // Disable B-frames for low latency
                encode_config.frameIntervalP = 1;
                encode_config.gopLength = target_fps;

                // Configure CBR rate control at the requested bitrate
                let bitrate_bps = target_bitrate_kbps * 1_000;
                encode_config.rcParams.rateControlMode =
                    nvidia_video_codec_sdk::sys::nvEncodeAPI::NV_ENC_PARAMS_RC_MODE::NV_ENC_PARAMS_RC_CBR;
                encode_config.rcParams.averageBitRate = bitrate_bps;
                encode_config.rcParams.maxBitRate = bitrate_bps;
                encode_config.rcParams.vbvBufferSize = bitrate_bps / target_fps;

                // Initialize encoder
                let mut init_params: NV_ENC_INITIALIZE_PARAMS = std::mem::zeroed();
                init_params.version =
                    nvidia_video_codec_sdk::sys::nvEncodeAPI::NV_ENC_INITIALIZE_PARAMS_VER;
                init_params.encodeGUID = NV_ENC_CODEC_H264_GUID;
                init_params.presetGUID = NV_ENC_PRESET_P4_GUID;
                init_params.encodeWidth = width;
                init_params.encodeHeight = height;
                init_params.darWidth = width;
                init_params.darHeight = height;
                init_params.frameRateNum = target_fps;
                init_params.frameRateDen = 1;
                init_params.enablePTD = 1;
                init_params.tuningInfo = NV_ENC_TUNING_INFO::NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY;
                init_params.encodeConfig = &mut encode_config;

                let status = (api.initialize_encoder)(encoder, &mut init_params);
                if !nvenc_status_ok(status) {
                    let _ = (api.destroy_encoder)(encoder);
                    return Err(format!(
                        "NVENC D3D11: initialize_encoder failed: {:?}",
                        status
                    ));
                }

                // Create output bitstream buffer
                let mut create_bitstream: NV_ENC_CREATE_BITSTREAM_BUFFER = std::mem::zeroed();
                create_bitstream.version =
                    nvidia_video_codec_sdk::sys::nvEncodeAPI::NV_ENC_CREATE_BITSTREAM_BUFFER_VER;

                let status = (api.create_bitstream_buffer)(encoder, &mut create_bitstream);
                if !nvenc_status_ok(status) {
                    let _ = (api.destroy_encoder)(encoder);
                    return Err(format!(
                        "NVENC D3D11: create_bitstream_buffer failed: {:?}",
                        status
                    ));
                }

                Ok(Self {
                    encoder,
                    output_bitstream: create_bitstream.bitstreamBuffer,
                    width,
                    height,
                    force_idr: false,
                    registered_texture_ptr: std::ptr::null_mut(),
                    registered_resource: std::ptr::null_mut(),
                })
            }
        }

        /// Ensure the given texture is registered with NVENC. Reuses the
        /// cached registration when the texture pointer hasn't changed
        /// (which is the common case since DxgiCaptureSession reuses its
        /// copy texture).
        fn ensure_registered(&mut self, texture_ptr: *mut c_void) -> Result<(), String> {
            if self.registered_texture_ptr == texture_ptr && !self.registered_resource.is_null() {
                return Ok(());
            }

            // Unregister previous resource if any
            self.unregister_current();

            unsafe {
                let api = &*ENCODE_API;

                let mut register: NV_ENC_REGISTER_RESOURCE = std::mem::zeroed();
                register.version =
                    nvidia_video_codec_sdk::sys::nvEncodeAPI::NV_ENC_REGISTER_RESOURCE_VER;
                register.resourceType =
                    NV_ENC_INPUT_RESOURCE_TYPE::NV_ENC_INPUT_RESOURCE_TYPE_DIRECTX;
                register.resourceToRegister = texture_ptr;
                register.width = self.width;
                register.height = self.height;
                register.pitch = 0; // D3D11 manages pitch internally
                register.bufferFormat = NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_ARGB;
                register.bufferUsage =
                    nvidia_video_codec_sdk::sys::nvEncodeAPI::NV_ENC_BUFFER_USAGE::NV_ENC_INPUT_IMAGE;

                let status = (api.register_resource)(self.encoder, &mut register);
                if !nvenc_status_ok(status) {
                    return Err(format!(
                        "NVENC D3D11: register_resource failed: {:?}",
                        status
                    ));
                }

                self.registered_texture_ptr = texture_ptr;
                self.registered_resource = register.registeredResource;
            }
            Ok(())
        }

        fn unregister_current(&mut self) {
            if !self.registered_resource.is_null() && !self.encoder.is_null() {
                unsafe {
                    let api = &*ENCODE_API;
                    let _ = (api.unregister_resource)(self.encoder, self.registered_resource);
                }
                self.registered_resource = std::ptr::null_mut();
                self.registered_texture_ptr = std::ptr::null_mut();
            }
        }

        fn encode_texture(&mut self, texture_ptr: *mut c_void) -> Result<Vec<u8>, String> {
            self.ensure_registered(texture_ptr)?;

            unsafe {
                let api = &*ENCODE_API;

                // Map the registered resource for encoding
                let mut map_input: NV_ENC_MAP_INPUT_RESOURCE = std::mem::zeroed();
                map_input.version =
                    nvidia_video_codec_sdk::sys::nvEncodeAPI::NV_ENC_MAP_INPUT_RESOURCE_VER;
                map_input.registeredResource = self.registered_resource;

                let status = (api.map_input_resource)(self.encoder, &mut map_input);
                if !nvenc_status_ok(status) {
                    // Registration may be stale — clear cache so next call re-registers
                    self.unregister_current();
                    return Err(format!(
                        "NVENC D3D11: map_input_resource failed: {:?}",
                        status
                    ));
                }

                let mapped_resource = map_input.mappedResource;
                let mapped_buffer_fmt = map_input.mappedBufferFmt;

                // Encode the picture
                let mut pic_params: NV_ENC_PIC_PARAMS = std::mem::zeroed();
                pic_params.version =
                    nvidia_video_codec_sdk::sys::nvEncodeAPI::NV_ENC_PIC_PARAMS_VER;
                pic_params.inputWidth = self.width;
                pic_params.inputHeight = self.height;
                pic_params.inputBuffer = mapped_resource;
                pic_params.outputBitstream = self.output_bitstream;
                pic_params.bufferFmt = mapped_buffer_fmt;
                pic_params.pictureStruct =
                    nvidia_video_codec_sdk::sys::nvEncodeAPI::NV_ENC_PIC_STRUCT::NV_ENC_PIC_STRUCT_FRAME;

                if self.force_idr {
                    pic_params.pictureType = NV_ENC_PIC_TYPE::NV_ENC_PIC_TYPE_IDR;
                    pic_params.encodePicFlags =
                        nvidia_video_codec_sdk::sys::nvEncodeAPI::NV_ENC_PIC_FLAG_FORCEIDR
                            | nvidia_video_codec_sdk::sys::nvEncodeAPI::NV_ENC_PIC_FLAG_OUTPUT_SPSPPS;
                    self.force_idr = false;
                }

                let status = (api.encode_picture)(self.encoder, &mut pic_params);
                let encode_ok =
                    nvenc_status_ok(status) || status == NVENCSTATUS::NV_ENC_ERR_NEED_MORE_INPUT;

                // Unmap regardless of encode result
                let _ = (api.unmap_input_resource)(self.encoder, mapped_resource);

                if status == NVENCSTATUS::NV_ENC_ERR_NEED_MORE_INPUT {
                    return Ok(Vec::new());
                }
                if !encode_ok {
                    return Err(format!("NVENC D3D11: encode_picture failed: {:?}", status));
                }

                // Lock and read the bitstream output
                let mut lock_bitstream: NV_ENC_LOCK_BITSTREAM = std::mem::zeroed();
                lock_bitstream.version =
                    nvidia_video_codec_sdk::sys::nvEncodeAPI::NV_ENC_LOCK_BITSTREAM_VER;
                lock_bitstream.outputBitstream = self.output_bitstream;

                let status = (api.lock_bitstream)(self.encoder, &mut lock_bitstream);
                if !nvenc_status_ok(status) {
                    return Err(format!("NVENC D3D11: lock_bitstream failed: {:?}", status));
                }

                let data = std::slice::from_raw_parts(
                    lock_bitstream.bitstreamBufferPtr as *const u8,
                    lock_bitstream.bitstreamSizeInBytes as usize,
                )
                .to_vec();

                let _ = (api.unlock_bitstream)(self.encoder, self.output_bitstream);

                Ok(data)
            }
        }

        fn request_keyframe(&mut self) {
            self.force_idr = true;
        }
    }

    impl Drop for NvencD3D11Session {
        fn drop(&mut self) {
            if !self.encoder.is_null() {
                self.unregister_current();
                unsafe {
                    let api = &*ENCODE_API;
                    let _ = (api.destroy_bitstream_buffer)(self.encoder, self.output_bitstream);
                    let _ = (api.destroy_encoder)(self.encoder);
                }
            }
        }
    }

    // ───────────────── Unified encoder backend ─────────────────

    enum NvencSessionMode {
        Cuda(NvencSdkSession),
        D3D11(NvencD3D11Session),
    }

    pub(super) struct NvencSdkEncoderBackend {
        target_fps: u32,
        target_bitrate_kbps: u32,
        session: Option<NvencSessionMode>,
    }

    impl NvencSdkEncoderBackend {
        fn new(target_fps: Option<u32>, target_bitrate_kbps: Option<u32>) -> Result<Self, String> {
            // Probe that CUDA + NVENC SDK is available.
            // TODO: On multi-GPU systems, consider matching CUDA device to the D3D11 device GPU.
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

        fn ensure_cuda_session(
            &mut self,
            width: u32,
            height: u32,
        ) -> Result<&mut NvencSdkSession, String> {
            let need_restart = match &self.session {
                Some(NvencSessionMode::Cuda(s)) => s.width != width || s.height != height,
                Some(NvencSessionMode::D3D11(_)) => true,
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
                self.session = Some(NvencSessionMode::Cuda(s));
            }

            match &mut self.session {
                Some(NvencSessionMode::Cuda(s)) => Ok(s),
                _ => Err("NVENC SDK CUDA session unavailable".to_string()),
            }
        }

        fn ensure_d3d11_session(
            &mut self,
            device_ptr: *mut c_void,
            width: u32,
            height: u32,
        ) -> Result<&mut NvencD3D11Session, String> {
            let need_restart = match &self.session {
                Some(NvencSessionMode::D3D11(s)) => s.width != width || s.height != height,
                Some(NvencSessionMode::Cuda(_)) => true,
                None => false,
            };

            if need_restart {
                self.session = None;
            }

            if self.session.is_none() {
                let s = NvencD3D11Session::open(
                    device_ptr,
                    width,
                    height,
                    self.target_fps,
                    self.target_bitrate_kbps,
                )?;
                self.session = Some(NvencSessionMode::D3D11(s));
            }

            match &mut self.session {
                Some(NvencSessionMode::D3D11(s)) => Ok(s),
                _ => Err("NVENC SDK D3D11 session unavailable".to_string()),
            }
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

            let session = match self.ensure_cuda_session(width, height) {
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
            match &mut self.session {
                Some(NvencSessionMode::Cuda(s)) => {
                    s.request_keyframe();
                    true
                }
                Some(NvencSessionMode::D3D11(s)) => {
                    s.request_keyframe();
                    true
                }
                None => false,
            }
        }

        fn encode_gpu_frame(
            &mut self,
            handle: &GpuTextureHandle,
            shared: &NativeSenderSharedMetrics,
        ) -> GpuEncodeResult {
            use windows::core::Interface;

            // Validate dimensions before creating D3D11 session to avoid
            // creating a session with invalid dimensions
            if handle.width == 0
                || handle.height == 0
                || !handle.width.is_multiple_of(2)
                || !handle.height.is_multiple_of(2)
            {
                shared.encode_errors.fetch_add(1, Ordering::Relaxed);
                return GpuEncodeResult::NotSupported;
            }

            // Get raw D3D11 device pointer for NVENC
            let device_ptr = handle.device.as_raw() as *mut c_void;
            let texture_ptr = handle.texture.as_raw() as *mut c_void;

            let session = match self.ensure_d3d11_session(device_ptr, handle.width, handle.height) {
                Ok(s) => s,
                Err(e) => {
                    shared.encode_errors.fetch_add(1, Ordering::Relaxed);
                    eprintln!(
                        "[native-sender] event=encode_error backend=nvenc_sdk_d3d11 \
                         detail=\"{e}\""
                    );
                    // Fall back to CPU readback path
                    return GpuEncodeResult::NotSupported;
                }
            };

            match session.encode_texture(texture_ptr) {
                Ok(data) if data.is_empty() => GpuEncodeResult::NoOutput,
                Ok(data) => {
                    let nals = split_annex_b_nals(&data);
                    if nals.is_empty() {
                        GpuEncodeResult::NoOutput
                    } else {
                        GpuEncodeResult::Encoded(nals)
                    }
                }
                Err(e) => {
                    shared.encode_errors.fetch_add(1, Ordering::Relaxed);
                    eprintln!(
                        "[native-sender] event=encode_error backend=nvenc_sdk_d3d11 \
                         detail=\"{e}\""
                    );
                    self.session = None;
                    GpuEncodeResult::NotSupported
                }
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

    use super::encoder_backend::split_annex_b_nals;
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
