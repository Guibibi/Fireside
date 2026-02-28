//! H264 software encoder using OpenH264 + dcv-color-primitives for BGRA→I420 conversion.

use dcv_color_primitives as dcp;
use openh264::encoder::{Encoder, EncoderConfig};
use openh264::formats::YUVSource;
use openh264::OpenH264API;

use super::capture_loop::CaptureFrame;

struct PlanarI420Frame<'a> {
    width: usize,
    height: usize,
    y: &'a [u8],
    u: &'a [u8],
    v: &'a [u8],
}

impl<'a> YUVSource for PlanarI420Frame<'a> {
    fn dimensions(&self) -> (usize, usize) {
        (self.width, self.height)
    }

    fn strides(&self) -> (usize, usize, usize) {
        (self.width, self.width / 2, self.width / 2)
    }

    fn y(&self) -> &[u8] {
        self.y
    }

    fn u(&self) -> &[u8] {
        self.u
    }

    fn v(&self) -> &[u8] {
        self.v
    }
}

pub struct H264Encoder {
    encoder: Encoder,
    /// Reusable I420 buffers to avoid per-frame allocation.
    y_buf: Vec<u8>,
    u_buf: Vec<u8>,
    v_buf: Vec<u8>,
    last_width: u32,
    last_height: u32,
    /// If true, force an IDR frame on the next encode call.
    force_idr: bool,
}

impl H264Encoder {
    /// Create a new OpenH264 encoder with the given target bitrate (kbps).
    pub fn new(bitrate_kbps: u32) -> Result<Self, String> {
        let config = EncoderConfig::new()
            .set_bitrate_bps(bitrate_kbps * 1000)
            .enable_skip_frame(false);

        let encoder = Encoder::with_api_config(OpenH264API::from_source(), config)
            .map_err(|e| format!("Failed to create OpenH264 encoder: {e}"))?;

        Ok(Self {
            encoder,
            y_buf: Vec::new(),
            u_buf: Vec::new(),
            v_buf: Vec::new(),
            last_width: 0,
            last_height: 0,
            force_idr: false,
        })
    }

    /// Request an IDR (keyframe) on the next encode call.
    pub fn request_keyframe(&mut self) {
        self.force_idr = true;
    }

    /// Encode a BGRA frame to H264 NAL units.
    ///
    /// Returns `Ok(Some(data))` if an access unit was produced, `Ok(None)` if the
    /// encoder buffered the frame without output, or `Err` on failure.
    pub fn encode_frame(&mut self, frame: &CaptureFrame) -> Result<Option<Vec<u8>>, String> {
        let w = frame.width;
        let h = frame.height;

        if w % 2 != 0 || h % 2 != 0 {
            return Err(format!(
                "OpenH264 requires even frame dimensions, got {}x{}",
                w, h
            ));
        }

        // Reallocate I420 buffers if dimensions changed.
        if w != self.last_width || h != self.last_height {
            let y_size = (w * h) as usize;
            let uv_size = y_size / 4;
            self.y_buf = vec![0u8; y_size];
            self.u_buf = vec![0u8; uv_size];
            self.v_buf = vec![0u8; uv_size];
            self.last_width = w;
            self.last_height = h;
        }

        // BGRA → I420 via dcv-color-primitives.
        bgra_to_i420(
            w,
            h,
            &frame.data,
            &mut self.y_buf,
            &mut self.u_buf,
            &mut self.v_buf,
        )?;

        let yuv = PlanarI420Frame {
            width: w as usize,
            height: h as usize,
            y: &self.y_buf,
            u: &self.u_buf,
            v: &self.v_buf,
        };

        if self.force_idr {
            self.encoder.force_intra_frame();
            self.force_idr = false;
        }

        // Encode.
        let bitstream = self
            .encoder
            .encode(&yuv)
            .map_err(|e| format!("OpenH264 encode error: {e}"))?;

        let output = bitstream.to_vec();

        if output.is_empty() {
            Ok(None)
        } else {
            Ok(Some(output))
        }
    }
}

/// Convert a BGRA8 image to planar I420 using dcv-color-primitives.
fn bgra_to_i420(
    width: u32,
    height: u32,
    bgra: &[u8],
    y_out: &mut [u8],
    u_out: &mut [u8],
    v_out: &mut [u8],
) -> Result<(), String> {
    use dcp::{convert_image, ColorSpace, ImageFormat, PixelFormat};

    let src_format = ImageFormat {
        pixel_format: PixelFormat::Bgra,
        color_space: ColorSpace::Rgb,
        num_planes: 1,
    };
    let dst_format = ImageFormat {
        pixel_format: PixelFormat::I420,
        color_space: ColorSpace::Bt601,
        num_planes: 3,
    };

    let src_sizes = &[(width * 4) as usize];
    let dst_sizes = &[width as usize, (width / 2) as usize, (width / 2) as usize];

    convert_image(
        width,
        height,
        &src_format,
        Some(src_sizes),
        &[bgra],
        &dst_format,
        Some(dst_sizes),
        &mut [y_out, u_out, v_out],
    )
    .map_err(|e| format!("dcv-color-primitives conversion error: {:?}", e))
}
