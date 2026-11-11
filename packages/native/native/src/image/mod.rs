//! Model-image preparation: decode the first frame, fit inside a dimension
//! limit, and re-encode under a base64 size limit. Plain Rust; the N-API
//! adapter is `napi.rs`.
pub(crate) mod napi;
mod transform;

use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageEncoder, ImageFormat, ImageReader, Limits};
use std::io::Cursor;

pub(crate) use transform::{image_info, transform_image};

/// Largest accepted encoded input.
pub(crate) const MAX_INPUT_BYTES: usize = 64 * 1024 * 1024;
/// Decoder caps: per-side dimension and total allocation.
const MAX_DECODE_SIDE: u32 = 20_000;
const MAX_DECODE_ALLOC: u64 = 768 * 1024 * 1024;
const JPEG_QUALITY: u8 = 85;
const SHRINK_FACTOR: f64 = 0.75;
const MAX_ATTEMPTS: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Png,
    Jpeg,
    Gif,
    Webp,
}

impl Format {
    pub(crate) fn parse(name: &str) -> Result<Self, String> {
        match name {
            "png" => Ok(Self::Png),
            "jpeg" => Ok(Self::Jpeg),
            "gif" => Ok(Self::Gif),
            "webp" => Ok(Self::Webp),
            other => Err(format!("Unsupported image format: {other}")),
        }
    }

    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpeg",
            Self::Gif => "gif",
            Self::Webp => "webp",
        }
    }

    pub(crate) fn mime(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Gif => "image/gif",
            Self::Webp => "image/webp",
        }
    }

    pub(super) fn from_image(format: ImageFormat) -> Option<Self> {
        match format {
            ImageFormat::Png => Some(Self::Png),
            ImageFormat::Jpeg => Some(Self::Jpeg),
            ImageFormat::Gif => Some(Self::Gif),
            ImageFormat::WebP => Some(Self::Webp),
            _ => None,
        }
    }
}

pub struct Options {
    pub max_dimension: u32,
    pub max_base64_bytes: usize,
    /// Formats that may be returned unchanged when already within limits.
    pub accepted_formats: Vec<Format>,
    /// Formats the encoder may produce (png and/or jpeg), in preference order.
    pub output_formats: Vec<Format>,
}

pub struct Prepared {
    pub data: Vec<u8>,
    pub format: Format,
    pub width: u32,
    pub height: u32,
    pub changed: bool,
}

fn base64_len(bytes: usize) -> usize {
    bytes.div_ceil(3) * 4
}

/// A reader that refuses images wider/taller than `MAX_DECODE_SIDE` or needing more than `max_alloc` bytes.
fn reader(data: &[u8], max_alloc: u64) -> Result<ImageReader<Cursor<&[u8]>>, String> {
    let mut reader = ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|error| format!("Could not read image: {error}"))?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DECODE_SIDE);
    limits.max_image_height = Some(MAX_DECODE_SIDE);
    limits.max_alloc = Some(max_alloc);
    reader.limits(limits);
    Ok(reader)
}

pub(crate) fn prepare(data: &[u8], options: &Options) -> Result<Prepared, String> {
    if options.max_dimension == 0 || options.max_base64_bytes == 0 {
        return Err("Image limits must be positive".into());
    }
    if options.output_formats.is_empty()
        || options
            .output_formats
            .iter()
            .any(|f| !matches!(f, Format::Png | Format::Jpeg))
    {
        return Err("outputFormats must be a non-empty list of png/jpeg".into());
    }
    if data.is_empty() {
        return Err("Image is empty".into());
    }
    if data.len() > MAX_INPUT_BYTES {
        return Err(format!(
            "Image exceeds the {MAX_INPUT_BYTES} byte input limit"
        ));
    }

    let probe = reader(data, MAX_DECODE_ALLOC)?;
    let source_format = probe
        .format()
        .and_then(Format::from_image)
        .ok_or("Unsupported or unrecognized image format")?;
    let (width, height) = {
        let decoder = probe
            .into_decoder()
            .map_err(|error| format!("Could not decode image: {error}"))?;
        decoder.dimensions()
    };

    if width <= options.max_dimension
        && height <= options.max_dimension
        && base64_len(data.len()) <= options.max_base64_bytes
        && options.accepted_formats.contains(&source_format)
    {
        return Ok(Prepared {
            data: data.to_vec(),
            format: source_format,
            width,
            height,
            changed: false,
        });
    }

    let decoded = reader(data, MAX_DECODE_ALLOC)?
        .decode()
        .map_err(|error| format!("Could not decode image: {error}"))?;
    let has_alpha = decoded.color().has_alpha();

    // PNG for PNG/GIF/WebP sources, JPEG for JPEG sources, when allowed.
    let preferred = if source_format == Format::Jpeg {
        Format::Jpeg
    } else {
        Format::Png
    };
    let first = if options.output_formats.contains(&preferred) {
        preferred
    } else {
        options.output_formats[0]
    };

    let (mut w, mut h) = fit(width, height, options.max_dimension);
    let mut current = if (w, h) == (width, height) {
        decoded
    } else {
        decoded.resize_exact(w, h, FilterType::Lanczos3)
    };

    let mut format = first;
    for attempt in 0..MAX_ATTEMPTS {
        let encoded = encode(&current, format, has_alpha, JPEG_QUALITY)?;
        if base64_len(encoded.len()) <= options.max_base64_bytes {
            return Ok(Prepared {
                data: encoded,
                format,
                width: w,
                height: h,
                changed: true,
            });
        }
        // Over the limit: prefer JPEG (when allowed) before shrinking.
        if format == Format::Png && options.output_formats.contains(&Format::Jpeg) {
            format = Format::Jpeg;
            continue;
        }
        if attempt + 1 == MAX_ATTEMPTS {
            break;
        }
        w = ((f64::from(w) * SHRINK_FACTOR) as u32).max(1);
        h = ((f64::from(h) * SHRINK_FACTOR) as u32).max(1);
        current = current.resize_exact(w, h, FilterType::Lanczos3);
    }
    Err(format!(
        "Image could not be reduced below {} base64 bytes",
        options.max_base64_bytes
    ))
}

/// Largest size inside `max` per side with the aspect ratio kept; never enlarges.
fn fit(width: u32, height: u32, max: u32) -> (u32, u32) {
    if width <= max && height <= max {
        return (width, height);
    }
    let scale = f64::from(max) / f64::from(width.max(height));
    let w = ((f64::from(width) * scale).round() as u32).clamp(1, max);
    let h = ((f64::from(height) * scale).round() as u32).clamp(1, max);
    (w, h)
}

fn encode(
    image: &DynamicImage,
    format: Format,
    has_alpha: bool,
    quality: u8,
) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    match format {
        Format::Jpeg => {
            let rgb = flatten_on_white(image);
            JpegEncoder::new_with_quality(&mut out, quality)
                .write_image(
                    rgb.as_raw(),
                    rgb.width(),
                    rgb.height(),
                    image::ExtendedColorType::Rgb8,
                )
                .map_err(|error| format!("JPEG encoding failed: {error}"))?;
        }
        Format::Png => {
            let result = if has_alpha {
                let rgba = image.to_rgba8();
                PngEncoder::new(&mut out).write_image(
                    rgba.as_raw(),
                    rgba.width(),
                    rgba.height(),
                    image::ExtendedColorType::Rgba8,
                )
            } else {
                let rgb = image.to_rgb8();
                PngEncoder::new(&mut out).write_image(
                    rgb.as_raw(),
                    rgb.width(),
                    rgb.height(),
                    image::ExtendedColorType::Rgb8,
                )
            };
            result.map_err(|error| format!("PNG encoding failed: {error}"))?;
        }
        _ => return Err("Unsupported output format".into()),
    }
    Ok(out)
}

fn flatten_on_white(image: &DynamicImage) -> image::RgbImage {
    let rgba = image.to_rgba8();
    let mut rgb = image::RgbImage::new(rgba.width(), rgba.height());
    for (src, dst) in rgba.pixels().zip(rgb.pixels_mut()) {
        let alpha = u32::from(src[3]);
        for c in 0..3 {
            let v = u32::from(src[c]) * alpha + 255 * (255 - alpha);
            dst[c] = ((v + 127) / 255) as u8;
        }
    }
    rgb
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn opts(max_dimension: u32, max_base64_bytes: usize) -> Options {
        Options {
            max_dimension,
            max_base64_bytes,
            accepted_formats: vec![Format::Png, Format::Jpeg, Format::Webp],
            output_formats: vec![Format::Png, Format::Jpeg],
        }
    }

    fn noisy(width: u32, height: u32) -> RgbaImage {
        let mut state = 0x1234_5678u32;
        RgbaImage::from_fn(width, height, |_, _| {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            let [a, b, c, _] = state.to_be_bytes();
            Rgba([a, b, c, 255])
        })
    }

    fn png(image: &RgbaImage) -> Vec<u8> {
        encode(
            &DynamicImage::ImageRgba8(image.clone()),
            Format::Png,
            true,
            JPEG_QUALITY,
        )
        .unwrap()
    }

    #[test]
    fn unchanged_when_within_limits() {
        let data = png(&noisy(40, 30));
        let out = prepare(&data, &opts(100, 1 << 20)).unwrap();
        assert!(!out.changed);
        assert_eq!(out.data, data);
        assert_eq!((out.width, out.height), (40, 30));
    }

    #[test]
    fn fits_inside_dimension_keeping_aspect() {
        let data = png(&noisy(128, 260));
        let out = prepare(&data, &opts(100, 1 << 22)).unwrap();
        assert!(out.changed);
        assert_eq!(out.format, Format::Png);
        assert_eq!((out.width, out.height), (49, 100));
        let decoded = image::load_from_memory(&out.data).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (49, 100));
    }

    #[test]
    fn never_enlarges() {
        assert_eq!(fit(10, 20, 100), (10, 20));
    }

    #[test]
    fn oversized_bytes_fall_back_to_jpeg_then_shrink() {
        let data = png(&noisy(200, 200));
        let limit = 20_000;
        assert!(base64_len(data.len()) > limit);
        let out = prepare(&data, &opts(1000, limit)).unwrap();
        assert!(out.changed);
        assert_eq!(out.format, Format::Jpeg);
        assert!(base64_len(out.data.len()) <= limit);
    }

    #[test]
    fn png_only_output_shrinks() {
        let data = png(&noisy(200, 200));
        let mut o = opts(1000, 40_000);
        o.output_formats = vec![Format::Png];
        let out = prepare(&data, &o).unwrap();
        assert_eq!(out.format, Format::Png);
        assert!(out.width < 200);
    }

    #[test]
    fn unreachable_limit_errors() {
        let data = png(&noisy(64, 64));
        assert!(prepare(&data, &opts(1000, 8)).is_err());
    }

    #[test]
    fn garbage_is_rejected() {
        assert!(prepare(b"not an image", &opts(100, 1000)).is_err());
        assert!(prepare(b"", &opts(100, 1000)).is_err());
    }

    #[test]
    fn gif_not_accepted_becomes_png() {
        let image = noisy(8, 8);
        let mut gif = Vec::new();
        DynamicImage::ImageRgba8(image)
            .write_to(&mut Cursor::new(&mut gif), ImageFormat::Gif)
            .unwrap();
        let out = prepare(&gif, &opts(100, 1 << 20)).unwrap();
        assert!(out.changed);
        assert_eq!(out.format, Format::Png);
    }

    #[test]
    fn alpha_is_flattened_onto_white_for_jpeg() {
        let transparent = RgbaImage::from_pixel(4, 4, Rgba([0, 0, 0, 0]));
        let rgb = flatten_on_white(&DynamicImage::ImageRgba8(transparent));
        assert_eq!(rgb.get_pixel(0, 0).0, [255, 255, 255]);
    }
}
