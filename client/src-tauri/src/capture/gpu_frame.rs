#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11Texture2D, D3D11_CPU_ACCESS_READ, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC;

/// A GPU-resident D3D11 texture handle that can be passed through the
/// capture pipeline without copying pixels to the CPU.
#[cfg(target_os = "windows")]
pub struct GpuTextureHandle {
    pub texture: ID3D11Texture2D,
    pub device: ID3D11Device,
    pub width: u32,
    pub height: u32,
}

// SAFETY: COM objects are reference-counted and the D3D11 device has
// multithread protection enabled. The texture and device are safe to
// move between threads.
#[cfg(target_os = "windows")]
unsafe impl Send for GpuTextureHandle {}

#[cfg(target_os = "windows")]
impl GpuTextureHandle {
    /// Copy the GPU texture to a CPU-accessible staging texture and read
    /// back the BGRA pixel data. This is the fallback path used when
    /// the encoder does not support direct GPU texture input.
    pub fn readback_bgra(&self) -> Result<Vec<u8>, String> {
        unsafe {
            let context = self
                .device
                .GetImmediateContext()
                .map_err(|e| format!("Failed to get D3D11 immediate context: {e}"))?;

            // Create a staging texture matching the source dimensions
            let staging_desc = D3D11_TEXTURE2D_DESC {
                Width: self.width,
                Height: self.height,
                MipLevels: 1,
                ArraySize: 1,
                Format: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Usage: D3D11_USAGE_STAGING,
                BindFlags: Default::default(),
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                MiscFlags: Default::default(),
            };

            let mut staging_texture = None;
            self.device
                .CreateTexture2D(&staging_desc, None, Some(&mut staging_texture))
                .map_err(|e| format!("Failed to create staging texture: {e}"))?;
            let staging =
                staging_texture.ok_or_else(|| "Staging texture was not created".to_string())?;

            // Copy GPU texture → staging texture
            context.CopyResource(&staging, &self.texture);

            // Map the staging texture for CPU read
            let mut mapped: D3D11_MAPPED_SUBRESOURCE = std::mem::zeroed();
            context
                .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                .map_err(|e| format!("Failed to map staging texture: {e}"))?;

            let row_pitch = mapped.RowPitch as usize;
            let target_row_bytes = self.width as usize * 4;
            let mut bgra = vec![0u8; target_row_bytes * self.height as usize];

            let src = mapped.pData as *const u8;
            for y in 0..self.height as usize {
                let src_row = src.add(y * row_pitch);
                let dst_offset = y * target_row_bytes;
                std::ptr::copy_nonoverlapping(
                    src_row,
                    bgra[dst_offset..].as_mut_ptr(),
                    target_row_bytes,
                );
            }

            context.Unmap(&staging, 0);

            Ok(bgra)
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub struct GpuTextureHandle {
    pub width: u32,
    pub height: u32,
}

#[cfg(not(target_os = "windows"))]
impl GpuTextureHandle {
    pub fn readback_bgra(&self) -> Result<Vec<u8>, String> {
        Err("GPU texture readback is only supported on Windows".to_string())
    }
}
