#[cfg(target_os = "windows")]
mod imp {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    use windows::core::Interface;
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Multithread, ID3D11Texture2D,
        D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
    };
    use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput, IDXGIOutput1,
        IDXGIOutputDuplication, DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_WAIT_TIMEOUT,
        DXGI_OUTDUPL_FRAME_INFO,
    };

    use crate::capture::gpu_frame::GpuTextureHandle;
    use crate::capture::windows_capture::{
        NativeCaptureSource, NativeCaptureSourceKind, NativeFrameData, NativeFramePacket,
    };

    fn unix_timestamp_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    pub struct DxgiCaptureSession {
        device: ID3D11Device,
        context: ID3D11DeviceContext,
        duplication: IDXGIOutputDuplication,
        width: u32,
        height: u32,
        /// Reusable copy texture to avoid per-frame GPU heap allocation.
        /// Recreated only when frame dimensions change.
        cached_copy_texture: Option<(ID3D11Texture2D, u32, u32)>,
    }

    // SAFETY: D3D11 device has multithread protection enabled.
    // All DXGI DD operations happen on the capture thread.
    unsafe impl Send for DxgiCaptureSession {}

    impl DxgiCaptureSession {
        pub fn new(monitor_device_name: &str) -> Result<Self, String> {
            unsafe {
                let factory: IDXGIFactory1 = CreateDXGIFactory1()
                    .map_err(|e| format!("DXGI: failed to create factory: {e}"))?;

                // Find the adapter and output matching the monitor device name
                let mut adapter_index = 0u32;
                loop {
                    let adapter: IDXGIAdapter1 =
                        factory.EnumAdapters1(adapter_index).map_err(|_| {
                            format!(
                                "DXGI: monitor '{}' not found among available outputs",
                                monitor_device_name
                            )
                        })?;

                    let mut output_index = 0u32;
                    loop {
                        let output: IDXGIOutput = match adapter.EnumOutputs(output_index) {
                            Ok(o) => o,
                            Err(_) => break,
                        };

                        let desc = output
                            .GetDesc()
                            .map_err(|e| format!("DXGI: failed to get output desc: {e}"))?;

                        let name = String::from_utf16_lossy(&desc.DeviceName)
                            .trim_end_matches('\0')
                            .to_string();

                        if name == monitor_device_name {
                            return Self::init_from_output(&adapter, &output);
                        }

                        output_index += 1;
                    }

                    adapter_index += 1;
                }
            }
        }

        unsafe fn init_from_output(
            adapter: &IDXGIAdapter1,
            output: &IDXGIOutput,
        ) -> Result<Self, String> {
            let mut device = None;
            let mut context = None;

            // When an explicit adapter is provided, driver type must be
            // D3D_DRIVER_TYPE_UNKNOWN per MSDN. Using HARDWARE with a
            // non-null adapter causes the adapter parameter to be ignored.
            D3D11CreateDevice(
                adapter,
                D3D_DRIVER_TYPE_UNKNOWN,
                None,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
            .map_err(|e| format!("DXGI: failed to create D3D11 device: {e}"))?;

            let device = device.ok_or_else(|| "DXGI: D3D11 device was not created".to_string())?;
            let context =
                context.ok_or_else(|| "DXGI: D3D11 device context was not created".to_string())?;

            // Enable multithread protection
            let mt: ID3D11Multithread = device
                .cast()
                .map_err(|e| format!("DXGI: failed to get ID3D11Multithread: {e}"))?;
            mt.SetMultithreadProtected(true);

            let output1: IDXGIOutput1 = output
                .cast()
                .map_err(|e| format!("DXGI: failed to cast to IDXGIOutput1: {e}"))?;

            let duplication = output1
                .DuplicateOutput(&device)
                .map_err(|e| format!("DXGI: failed to duplicate output: {e}"))?;

            let desc = output
                .GetDesc()
                .map_err(|e| format!("DXGI: failed to get output desc: {e}"))?;

            let width = (desc.DesktopCoordinates.right - desc.DesktopCoordinates.left) as u32;
            let height = (desc.DesktopCoordinates.bottom - desc.DesktopCoordinates.top) as u32;

            Ok(Self {
                device,
                context,
                duplication,
                width,
                height,
                cached_copy_texture: None,
            })
        }

        pub fn device(&self) -> &ID3D11Device {
            &self.device
        }

        pub fn width(&self) -> u32 {
            self.width
        }

        pub fn height(&self) -> u32 {
            self.height
        }

        /// Acquire the next desktop frame as a GPU texture.
        /// Returns `Ok(None)` on timeout (no new frame available).
        /// Returns `Err` with `DXGI_ERROR_ACCESS_LOST` message when the
        /// duplication must be recreated.
        pub fn acquire_frame(
            &mut self,
            timeout_ms: u32,
        ) -> Result<Option<GpuTextureHandle>, String> {
            unsafe {
                let mut frame_info = DXGI_OUTDUPL_FRAME_INFO::default();
                let mut resource = None;

                let result =
                    self.duplication
                        .AcquireNextFrame(timeout_ms, &mut frame_info, &mut resource);

                match result {
                    Ok(()) => {}
                    Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => {
                        return Ok(None);
                    }
                    Err(e) if e.code() == DXGI_ERROR_ACCESS_LOST => {
                        return Err("DXGI_ERROR_ACCESS_LOST".to_string());
                    }
                    Err(e) => {
                        return Err(format!("DXGI: AcquireNextFrame failed: {e}"));
                    }
                }

                // Ensure ReleaseFrame is always called, even if subsequent operations fail.
                // This prevents resource leaks from stranded DXGI frames.
                struct FrameGuard<'a> {
                    duplication: &'a IDXGIOutputDuplication,
                    released: bool,
                }
                impl<'a> Drop for FrameGuard<'a> {
                    fn drop(&mut self) {
                        if !self.released {
                            let _ = unsafe { self.duplication.ReleaseFrame() };
                        }
                    }
                }
                let mut guard = FrameGuard {
                    duplication: &self.duplication,
                    released: false,
                };

                let resource =
                    resource.ok_or_else(|| "DXGI: acquired frame resource was null".to_string())?;
                let desktop_texture: ID3D11Texture2D = resource
                    .cast()
                    .map_err(|e| format!("DXGI: failed to cast resource to texture: {e}"))?;

                // Copy the desktop texture to a reusable staging texture.
                // The acquired resource must be released before the next
                // AcquireNextFrame call, so we keep a persistent copy target.
                let mut src_desc = D3D11_TEXTURE2D_DESC::default();
                desktop_texture.GetDesc(&mut src_desc);

                let dims_match = self
                    .cached_copy_texture
                    .as_ref()
                    .map(|(_, w, h)| *w == src_desc.Width && *h == src_desc.Height)
                    .unwrap_or(false);

                if !dims_match {
                    let copy_desc = D3D11_TEXTURE2D_DESC {
                        Width: src_desc.Width,
                        Height: src_desc.Height,
                        MipLevels: 1,
                        ArraySize: 1,
                        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                        SampleDesc: src_desc.SampleDesc,
                        Usage: Default::default(), // D3D11_USAGE_DEFAULT
                        BindFlags: Default::default(),
                        CPUAccessFlags: Default::default(),
                        MiscFlags: Default::default(),
                    };

                    let mut new_texture = None;
                    self.device
                        .CreateTexture2D(&copy_desc, None, Some(&mut new_texture))
                        .map_err(|e| format!("DXGI: failed to create copy texture: {e}"))?;
                    let tex = new_texture
                        .ok_or_else(|| "DXGI: copy texture was not created".to_string())?;
                    self.cached_copy_texture = Some((tex, src_desc.Width, src_desc.Height));
                }

                let (copy, _, _) = self.cached_copy_texture.as_ref().unwrap();
                self.context.CopyResource(copy, &desktop_texture);

                // Explicitly release the frame and mark guard as released
                self.duplication
                    .ReleaseFrame()
                    .map_err(|e| format!("DXGI: ReleaseFrame failed: {e}"))?;
                guard.released = true;

                Ok(Some(GpuTextureHandle {
                    texture: copy.clone(),
                    device: self.device.clone(),
                    width: src_desc.Width,
                    height: src_desc.Height,
                }))
            }
        }
    }

    /// Run the DXGI Desktop Duplication capture loop on the current thread.
    /// Dispatches `NativeFramePacket` with `GpuTexture` data to the frame sink.
    pub fn run_dxgi_capture_loop(
        monitor_device_name: &str,
        source_id: &str,
        stop_signal: Arc<AtomicBool>,
        target_fps: Option<u32>,
        dispatch_fn: impl Fn(NativeFramePacket),
    ) {
        let mut session = match DxgiCaptureSession::new(monitor_device_name) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[dxgi-capture] event=init_failed source={source_id} detail=\"{e}\"");
                return;
            }
        };

        eprintln!(
            "[dxgi-capture] event=started source={source_id} monitor={monitor_device_name} \
             size={}x{}",
            session.width(),
            session.height(),
        );

        let mut frame_count: u64 = 0;
        let start = Instant::now();
        let mut last_report = start;
        let mut reported_frames: u64 = 0;
        // Use target_fps for frame rate limiting, default to 60fps
        let fps = target_fps.unwrap_or(60).max(1);
        let min_frame_interval = Duration::from_micros(1_000_000 / fps as u64);
        let mut last_frame_at = Instant::now();

        while !stop_signal.load(Ordering::Relaxed) {
            // Throttle to ~60fps
            let elapsed_since_last = last_frame_at.elapsed();
            if elapsed_since_last < min_frame_interval {
                std::thread::sleep(min_frame_interval - elapsed_since_last);
            }

            match session.acquire_frame(100) {
                Ok(Some(handle)) => {
                    last_frame_at = Instant::now();
                    frame_count += 1;

                    let width = handle.width;
                    let height = handle.height;

                    dispatch_fn(NativeFramePacket {
                        source_id: source_id.to_string(),
                        width,
                        height,
                        timestamp_ms: unix_timestamp_ms(),
                        pixel_format: "bgra8".to_string(),
                        bgra_len: Some((width as usize) * (height as usize) * 4),
                        frame_data: Some(NativeFrameData::GpuTexture(handle)),
                    });

                    // Periodic stats
                    let now = Instant::now();
                    if now.duration_since(last_report) >= Duration::from_secs(1) {
                        let delta = frame_count - reported_frames;
                        let elapsed = now.duration_since(last_report).as_secs_f64();
                        let fps = if elapsed > 0.0 {
                            delta as f64 / elapsed
                        } else {
                            0.0
                        };
                        eprintln!(
                            "[dxgi-capture] event=stats source={source_id} fps={fps:.1} \
                             frames={frame_count} uptime_ms={}",
                            start.elapsed().as_millis(),
                        );
                        last_report = now;
                        reported_frames = frame_count;
                    }
                }
                Ok(None) => {
                    // Timeout — no new frame, loop again
                }
                Err(e) if e.contains("ACCESS_LOST") => {
                    eprintln!(
                        "[dxgi-capture] event=access_lost source={source_id} — recreating session"
                    );
                    // Exponential backoff retry for session recreation
                    const MAX_RETRIES: u32 = 5;
                    const INITIAL_DELAY_MS: u64 = 100;
                    let mut retry_count = 0u32;
                    let mut recreated = false;
                    while retry_count < MAX_RETRIES && !stop_signal.load(Ordering::Relaxed) {
                        let delay_ms = INITIAL_DELAY_MS * (1u64 << retry_count.min(4)); // cap at 1600ms
                        std::thread::sleep(Duration::from_millis(delay_ms));
                        match DxgiCaptureSession::new(monitor_device_name) {
                            Ok(new_session) => {
                                session = new_session;
                                recreated = true;
                                eprintln!(
                                    "[dxgi-capture] event=session_recreated source={source_id} \
                                     retries={retry_count}"
                                );
                                break;
                            }
                            Err(e) => {
                                retry_count += 1;
                                if retry_count < MAX_RETRIES {
                                    eprintln!(
                                        "[dxgi-capture] event=recreate_retry source={source_id} \
                                         attempt={retry_count} detail=\"{e}\""
                                    );
                                } else {
                                    eprintln!(
                                        "[dxgi-capture] event=recreate_failed source={source_id} \
                                         attempts={MAX_RETRIES} detail=\"{e}\""
                                    );
                                }
                            }
                        }
                    }
                    if !recreated {
                        break;
                    }
                }
                Err(e) => {
                    eprintln!(
                        "[dxgi-capture] event=acquire_error source={source_id} detail=\"{e}\""
                    );
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        }

        eprintln!("[dxgi-capture] event=stopped source={source_id} frames={frame_count}");
    }

    /// List monitors available for DXGI Desktop Duplication capture.
    #[allow(dead_code)]
    pub fn list_dxgi_monitors() -> Result<Vec<NativeCaptureSource>, String> {
        unsafe {
            let factory: IDXGIFactory1 =
                CreateDXGIFactory1().map_err(|e| format!("DXGI: failed to create factory: {e}"))?;

            let mut sources = Vec::new();
            let mut adapter_index = 0u32;

            loop {
                let adapter: IDXGIAdapter1 = match factory.EnumAdapters1(adapter_index) {
                    Ok(a) => a,
                    Err(_) => break,
                };

                let mut output_index = 0u32;
                loop {
                    let output: IDXGIOutput = match adapter.EnumOutputs(output_index) {
                        Ok(o) => o,
                        Err(_) => break,
                    };

                    if let Ok(desc) = output.GetDesc() {
                        let name = String::from_utf16_lossy(&desc.DeviceName)
                            .trim_end_matches('\0')
                            .to_string();

                        let width =
                            (desc.DesktopCoordinates.right - desc.DesktopCoordinates.left) as u32;
                        let height =
                            (desc.DesktopCoordinates.bottom - desc.DesktopCoordinates.top) as u32;

                        sources.push(NativeCaptureSource {
                            id: format!("screen:{name}"),
                            kind: NativeCaptureSourceKind::Screen,
                            title: name,
                            app_name: None,
                            width: Some(width),
                            height: Some(height),
                        });
                    }

                    output_index += 1;
                }

                adapter_index += 1;
            }

            Ok(sources)
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::run_dxgi_capture_loop;

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
pub fn list_dxgi_monitors(
) -> Result<Vec<crate::capture::windows_capture::NativeCaptureSource>, String> {
    Ok(Vec::new())
}
