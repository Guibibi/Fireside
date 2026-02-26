use windows::core::Interface;
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Multithread, ID3D11Texture2D,
    D3D11_BOX, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput, IDXGIOutput1,
    IDXGIOutputDuplication, DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_WAIT_TIMEOUT,
    DXGI_OUTDUPL_FRAME_INFO,
};

use crate::capture::gpu_frame::GpuTextureHandle;

#[derive(Debug, Clone, Copy)]
pub(super) struct RectI32 {
    pub(super) left: i32,
    pub(super) top: i32,
    pub(super) right: i32,
    pub(super) bottom: i32,
}

impl RectI32 {
    pub(super) fn width(self) -> u32 {
        (i64::from(self.right) - i64::from(self.left)).max(0) as u32
    }

    pub(super) fn height(self) -> u32 {
        (i64::from(self.bottom) - i64::from(self.top)).max(0) as u32
    }
}

#[derive(Debug, Clone)]
pub(super) struct DxgiOutputInfo {
    pub(super) device_name: String,
    pub(super) desktop_rect: RectI32,
}

impl DxgiOutputInfo {
    pub(super) fn width(&self) -> u32 {
        self.desktop_rect.width()
    }

    pub(super) fn height(&self) -> u32 {
        self.desktop_rect.height()
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) struct CropRect {
    pub(super) left: u32,
    pub(super) top: u32,
    pub(super) right: u32,
    pub(super) bottom: u32,
}

impl CropRect {
    pub(super) fn width(self) -> u32 {
        self.right.saturating_sub(self.left)
    }

    pub(super) fn height(self) -> u32 {
        self.bottom.saturating_sub(self.top)
    }
}

pub(super) struct DxgiCaptureSession {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    duplication: IDXGIOutputDuplication,
    width: u32,
    height: u32,
    cached_copy_texture: Option<(ID3D11Texture2D, u32, u32)>,
    cached_crop_texture: Option<(ID3D11Texture2D, u32, u32)>,
}

unsafe impl Send for DxgiCaptureSession {}

impl DxgiCaptureSession {
    pub(super) fn new(monitor_device_name: &str) -> Result<Self, String> {
        unsafe {
            let factory: IDXGIFactory1 =
                CreateDXGIFactory1().map_err(|e| format!("DXGI: failed to create factory: {e}"))?;

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

        let mt: ID3D11Multithread = device
            .cast()
            .map_err(|e| format!("DXGI: failed to get ID3D11Multithread: {e}"))?;
        let _ = mt.SetMultithreadProtected(true);

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
            cached_crop_texture: None,
        })
    }

    pub(super) fn width(&self) -> u32 {
        self.width
    }

    pub(super) fn height(&self) -> u32 {
        self.height
    }

    pub(super) fn acquire_frame(
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
                    Usage: Default::default(),
                    BindFlags: Default::default(),
                    CPUAccessFlags: Default::default(),
                    MiscFlags: Default::default(),
                };

                let mut new_texture = None;
                self.device
                    .CreateTexture2D(&copy_desc, None, Some(&mut new_texture))
                    .map_err(|e| format!("DXGI: failed to create copy texture: {e}"))?;
                let tex =
                    new_texture.ok_or_else(|| "DXGI: copy texture was not created".to_string())?;
                self.cached_copy_texture = Some((tex, src_desc.Width, src_desc.Height));
            }

            let (copy, _, _) = self.cached_copy_texture.as_ref().unwrap();
            self.context.CopyResource(copy, &desktop_texture);

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

    pub(super) fn crop_frame(
        &mut self,
        full_frame: &GpuTextureHandle,
        crop_rect: CropRect,
    ) -> Result<GpuTextureHandle, String> {
        let crop_width = crop_rect.width();
        let crop_height = crop_rect.height();
        if crop_width == 0 || crop_height == 0 {
            return Err("DXGI: crop dimensions were zero".to_string());
        }

        unsafe {
            let mut src_desc = D3D11_TEXTURE2D_DESC::default();
            full_frame.texture.GetDesc(&mut src_desc);

            let dims_match = self
                .cached_crop_texture
                .as_ref()
                .map(|(_, w, h)| *w == crop_width && *h == crop_height)
                .unwrap_or(false);

            if !dims_match {
                let crop_desc = D3D11_TEXTURE2D_DESC {
                    Width: crop_width,
                    Height: crop_height,
                    MipLevels: 1,
                    ArraySize: 1,
                    Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                    SampleDesc: src_desc.SampleDesc,
                    Usage: Default::default(),
                    BindFlags: Default::default(),
                    CPUAccessFlags: Default::default(),
                    MiscFlags: Default::default(),
                };

                let mut new_texture = None;
                self.device
                    .CreateTexture2D(&crop_desc, None, Some(&mut new_texture))
                    .map_err(|e| format!("DXGI: failed to create crop texture: {e}"))?;
                let tex =
                    new_texture.ok_or_else(|| "DXGI: crop texture was not created".to_string())?;
                self.cached_crop_texture = Some((tex, crop_width, crop_height));
            }

            let (crop_texture, _, _) = self.cached_crop_texture.as_ref().unwrap();
            let src_box = D3D11_BOX {
                left: crop_rect.left,
                top: crop_rect.top,
                front: 0,
                right: crop_rect.right,
                bottom: crop_rect.bottom,
                back: 1,
            };

            self.context.CopySubresourceRegion(
                crop_texture,
                0,
                0,
                0,
                0,
                &full_frame.texture,
                0,
                Some(&src_box as *const D3D11_BOX),
            );

            Ok(GpuTextureHandle {
                texture: crop_texture.clone(),
                device: self.device.clone(),
                width: crop_width,
                height: crop_height,
            })
        }
    }
}

pub(super) fn enumerate_dxgi_outputs() -> Result<Vec<DxgiOutputInfo>, String> {
    unsafe {
        let factory: IDXGIFactory1 =
            CreateDXGIFactory1().map_err(|e| format!("DXGI: failed to create factory: {e}"))?;

        let mut outputs = Vec::new();
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
                    let device_name = String::from_utf16_lossy(&desc.DeviceName)
                        .trim_end_matches('\0')
                        .to_string();
                    let desktop_rect = RectI32 {
                        left: desc.DesktopCoordinates.left,
                        top: desc.DesktopCoordinates.top,
                        right: desc.DesktopCoordinates.right,
                        bottom: desc.DesktopCoordinates.bottom,
                    };

                    outputs.push(DxgiOutputInfo {
                        device_name,
                        desktop_rect,
                    });
                }

                output_index += 1;
            }

            adapter_index += 1;
        }

        Ok(outputs)
    }
}
