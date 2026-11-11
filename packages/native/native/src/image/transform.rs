//! General-purpose image operations for the code-mode sandbox: inspect, or
//! crop → resize → encode. Plain Rust; the N-API adapter is `napi.rs`.
use super::{Format, JPEG_QUALITY, encode, reader};
use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder};

/// Largest accepted encoded input for these operations.
const MAX_INPUT_BYTES: usize = 50 * 1024 * 1024;
/// Largest accepted source or result area. A decoded 40 MP RGBA frame is 160 MB,
/// and crop and resize each hold another copy next to it, so peak use stays
/// under ~0.5 GB (100 MP would be 1.2 GB).
const MAX_PIXELS: u64 = 40_000_000;
/// Decoder allocation cap: one RGBA8 frame at `MAX_PIXELS` plus headroom.
const MAX_TRANSFORM_ALLOC: u64 = 256 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fit {
    Inside,
    Cover,
    Fill,
}

impl Fit {
    pub(crate) fn parse(name: &str) -> Result<Self, String> {
        match name {
            "inside" => Ok(Self::Inside),
            "cover" => Ok(Self::Cover),
            "fill" => Ok(Self::Fill),
            other => Err(format!("Unsupported fit: {other}")),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Crop {
    pub left: u32,
    pub top: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct Resize {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fit: Fit,
}

#[derive(Clone, Debug, Default)]
pub struct Transform {
    pub crop: Option<Crop>,
    pub resize: Option<Resize>,
    /// Png or Jpeg; defaults to the input format when that is png/jpeg, else png.
    pub format: Option<Format>,
    pub quality: Option<u8>,
}

pub struct Transformed {
    pub data: Vec<u8>,
    pub format: Format,
    pub width: u32,
    pub height: u32,
}

pub struct Info {
    pub format: Format,
    pub width: u32,
    pub height: u32,
}

fn check_input(data: &[u8]) -> Result<(), String> {
    if data.is_empty() {
        return Err("Image is empty".into());
    }
    if data.len() > MAX_INPUT_BYTES {
        return Err(format!(
            "Image exceeds the {MAX_INPUT_BYTES} byte input limit"
        ));
    }
    Ok(())
}

fn check_area(width: u32, height: u32, what: &str) -> Result<(), String> {
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(format!("{what} exceeds the 40 megapixel limit"));
    }
    Ok(())
}

pub(crate) fn image_info(data: &[u8]) -> Result<Info, String> {
    check_input(data)?;
    let probe = reader(data, MAX_TRANSFORM_ALLOC)?;
    let format = probe
        .format()
        .and_then(Format::from_image)
        .ok_or("Unsupported or unrecognized image format")?;
    let (width, height) = probe
        .into_decoder()
        .map_err(|error| format!("Could not decode image: {error}"))?
        .dimensions();
    check_area(width, height, "Image")?;
    Ok(Info {
        format,
        width,
        height,
    })
}

/// Target size for a resize of a `width`×`height` image.
fn target_size(width: u32, height: u32, resize: &Resize) -> Result<(u32, u32), String> {
    let positive = |v: Option<u32>| v.is_none_or(|v| v > 0);
    if !positive(resize.width) || !positive(resize.height) {
        return Err("resize width and height must be positive".into());
    }
    let (tw, th) = match (resize.width, resize.height) {
        (None, None) => return Err("resize needs a width or a height".into()),
        (Some(w), Some(h)) => (w, h),
        (Some(w), None) => (w, scaled(height, w, width)),
        (None, Some(h)) => (scaled(width, h, height), h),
    };
    match resize.fit {
        Fit::Cover | Fit::Fill => Ok((tw, th)),
        Fit::Inside => {
            if tw >= width && th >= height {
                return Ok((width, height));
            }
            let scale = (f64::from(tw) / f64::from(width)).min(f64::from(th) / f64::from(height));
            Ok((
                ((f64::from(width) * scale).round() as u32).clamp(1, tw),
                ((f64::from(height) * scale).round() as u32).clamp(1, th),
            ))
        }
    }
}

/// `value * to / from`, rounded, at least 1.
fn scaled(value: u32, to: u32, from: u32) -> u32 {
    ((f64::from(value) * f64::from(to) / f64::from(from)).round() as u32).max(1)
}

pub(crate) fn transform_image(data: &[u8], ops: &Transform) -> Result<Transformed, String> {
    check_input(data)?;
    if ops.quality.is_some_and(|q| !(1..=100).contains(&q)) {
        return Err("quality must be between 1 and 100".into());
    }
    let info = image_info(data)?;
    let output = match ops.format {
        Some(Format::Png) => Format::Png,
        Some(Format::Jpeg) => Format::Jpeg,
        Some(_) => return Err("format must be png or jpeg".into()),
        None if info.format == Format::Jpeg => Format::Jpeg,
        None => Format::Png,
    };

    // Validate everything that depends only on the header before decoding.
    let (mut width, mut height) = (info.width, info.height);
    if let Some(crop) = ops.crop {
        if crop.width == 0 || crop.height == 0 {
            return Err("crop width and height must be positive".into());
        }
        let right = u64::from(crop.left) + u64::from(crop.width);
        let bottom = u64::from(crop.top) + u64::from(crop.height);
        if right > u64::from(width) || bottom > u64::from(height) {
            return Err(format!("crop exceeds the image bounds ({width}x{height})"));
        }
        (width, height) = (crop.width, crop.height);
    }
    let target = ops
        .resize
        .map(|resize| target_size(width, height, &resize))
        .transpose()?;
    if let Some((w, h)) = target {
        check_area(w, h, "Resized image")?;
    }

    let decoded = reader(data, MAX_TRANSFORM_ALLOC)?
        .decode()
        .map_err(|error| format!("Could not decode image: {error}"))?;
    let has_alpha = decoded.color().has_alpha();
    let mut current = decoded;
    if let Some(crop) = ops.crop {
        current = current.crop_imm(crop.left, crop.top, crop.width, crop.height);
    }
    if let (Some(resize), Some((w, h))) = (ops.resize, target) {
        current = resize_to(current, w, h, resize.fit);
    }

    let encoded = encode(
        &current,
        output,
        has_alpha,
        ops.quality.unwrap_or(JPEG_QUALITY),
    )?;
    Ok(Transformed {
        data: encoded,
        format: output,
        width: current.width(),
        height: current.height(),
    })
}

fn resize_to(image: DynamicImage, width: u32, height: u32, fit: Fit) -> DynamicImage {
    if (image.width(), image.height()) == (width, height) {
        return image;
    }
    match fit {
        Fit::Inside | Fit::Fill => image.resize_exact(width, height, FilterType::Lanczos3),
        Fit::Cover => image.resize_to_fill(width, height, FilterType::Lanczos3),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn noisy(width: u32, height: u32) -> RgbaImage {
        let mut state = 0x1234_5678u32;
        RgbaImage::from_fn(width, height, |_, _| {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            let [a, b, c, _] = state.to_be_bytes();
            Rgba([a, b, c, 255])
        })
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        encode(
            &DynamicImage::ImageRgba8(noisy(width, height)),
            Format::Png,
            true,
            JPEG_QUALITY,
        )
        .unwrap()
    }

    fn resize(width: Option<u32>, height: Option<u32>, fit: Fit) -> Transform {
        Transform {
            resize: Some(Resize { width, height, fit }),
            ..Transform::default()
        }
    }

    fn size(out: &Transformed) -> (u32, u32) {
        let decoded = image::load_from_memory(&out.data).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (out.width, out.height));
        (out.width, out.height)
    }

    #[test]
    fn info_reads_header() {
        let info = image_info(&png(30, 20)).unwrap();
        assert_eq!(
            (info.format, info.width, info.height),
            (Format::Png, 30, 20)
        );
        assert!(image_info(b"nope").is_err());
        assert!(image_info(b"").is_err());
    }

    #[test]
    fn no_ops_reencodes_in_input_format() {
        let out = transform_image(&png(10, 10), &Transform::default()).unwrap();
        assert_eq!(out.format, Format::Png);
        assert_eq!(size(&out), (10, 10));
    }

    #[test]
    fn crop_then_resize() {
        let ops = Transform {
            crop: Some(Crop {
                left: 10,
                top: 20,
                width: 80,
                height: 40,
            }),
            resize: Some(Resize {
                width: Some(40),
                height: None,
                fit: Fit::Inside,
            }),
            ..Transform::default()
        };
        let out = transform_image(&png(100, 100), &ops).unwrap();
        assert_eq!(size(&out), (40, 20));
    }

    #[test]
    fn crop_out_of_bounds_or_empty_is_rejected() {
        let data = png(50, 50);
        for (left, top, width, height) in [(40, 0, 20, 10), (0, 0, 0, 10), (0, 45, 10, 10)] {
            let ops = Transform {
                crop: Some(Crop {
                    left,
                    top,
                    width,
                    height,
                }),
                ..Transform::default()
            };
            assert!(transform_image(&data, &ops).is_err());
        }
    }

    #[test]
    fn inside_keeps_aspect_and_never_enlarges() {
        let data = png(200, 100);
        let out = transform_image(&data, &resize(Some(50), Some(50), Fit::Inside)).unwrap();
        assert_eq!(size(&out), (50, 25));
        let out = transform_image(&data, &resize(Some(500), Some(500), Fit::Inside)).unwrap();
        assert_eq!(size(&out), (200, 100));
        let out = transform_image(&data, &resize(None, Some(400), Fit::Inside)).unwrap();
        assert_eq!(size(&out), (200, 100));
        let out = transform_image(&data, &resize(None, Some(50), Fit::Inside)).unwrap();
        assert_eq!(size(&out), (100, 50));
    }

    #[test]
    fn cover_and_fill_produce_exact_size() {
        let data = png(200, 100);
        for fit in [Fit::Cover, Fit::Fill] {
            let out = transform_image(&data, &resize(Some(60), Some(60), fit)).unwrap();
            assert_eq!(size(&out), (60, 60));
        }
        let out = transform_image(&data, &resize(Some(400), None, Fit::Cover)).unwrap();
        assert_eq!(size(&out), (400, 200));
    }

    #[test]
    fn invalid_resize_is_rejected() {
        let data = png(20, 20);
        assert!(transform_image(&data, &resize(None, None, Fit::Inside)).is_err());
        assert!(transform_image(&data, &resize(Some(0), None, Fit::Inside)).is_err());
        // Result area over the limit.
        assert!(transform_image(&data, &resize(Some(20_000), Some(20_000), Fit::Fill)).is_err());
    }

    #[test]
    fn format_and_quality() {
        let data = png(120, 120);
        let jpeg = |quality| Transform {
            format: Some(Format::Jpeg),
            quality,
            ..Transform::default()
        };
        let low = transform_image(&data, &jpeg(Some(10))).unwrap();
        let high = transform_image(&data, &jpeg(Some(95))).unwrap();
        assert_eq!(low.format, Format::Jpeg);
        assert!(low.data.len() < high.data.len());
        assert_eq!(&low.data[..2], &[0xff, 0xd8]);
        // Default follows the input: JPEG in, JPEG out.
        let again = transform_image(&low.data, &Transform::default()).unwrap();
        assert_eq!(again.format, Format::Jpeg);
        // Back to PNG on request.
        let back = transform_image(
            &low.data,
            &Transform {
                format: Some(Format::Png),
                ..Transform::default()
            },
        )
        .unwrap();
        assert_eq!(back.format, Format::Png);
        assert!(transform_image(&data, &jpeg(Some(0))).is_err());
        assert!(transform_image(&data, &jpeg(Some(101))).is_err());
    }

    #[test]
    fn gif_input_defaults_to_png() {
        let mut gif = Vec::new();
        DynamicImage::ImageRgba8(noisy(8, 8))
            .write_to(&mut std::io::Cursor::new(&mut gif), image::ImageFormat::Gif)
            .unwrap();
        assert_eq!(image_info(&gif).unwrap().format, Format::Gif);
        let out = transform_image(&gif, &Transform::default()).unwrap();
        assert_eq!(out.format, Format::Png);
        let bad = Transform {
            format: Some(Format::Gif),
            ..Transform::default()
        };
        assert!(transform_image(&gif, &bad).is_err());
    }

    #[test]
    fn oversized_input_is_rejected() {
        let big = vec![0u8; MAX_INPUT_BYTES + 1];
        assert!(image_info(&big).is_err());
        assert!(transform_image(&big, &Transform::default()).is_err());
    }

    #[test]
    fn oversized_area_is_rejected() {
        // 12000x9000 = 108 MP: a valid, tiny PNG header-wise but over the cap.
        let data = png_header_only(12_000, 9_000);
        assert!(image_info(&data).is_err());
    }

    /// PNG signature + IHDR only; enough for header probing.
    fn png_header_only(width: u32, height: u32) -> Vec<u8> {
        let mut out = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
        let mut ihdr = b"IHDR".to_vec();
        ihdr.extend(width.to_be_bytes());
        ihdr.extend(height.to_be_bytes());
        ihdr.extend([8, 2, 0, 0, 0]);
        out.extend(&ihdr);
        out.extend([0, 0, 0, 0]); // CRC not validated while probing
        out
    }

    /// A tiny "bomb": a few dozen bytes declaring a 10000x10000 image.
    fn declared_png(width: u32, height: u32) -> Vec<u8> {
        fn crc(bytes: &[u8]) -> u32 {
            let mut crc = 0xFFFF_FFFFu32;
            for byte in bytes {
                crc ^= u32::from(*byte);
                for _ in 0..8 {
                    crc = if crc & 1 == 1 {
                        (crc >> 1) ^ 0xEDB8_8320
                    } else {
                        crc >> 1
                    };
                }
            }
            !crc
        }
        fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], body: &[u8]) {
            out.extend((body.len() as u32).to_be_bytes());
            let mut checked = kind.to_vec();
            checked.extend(body);
            out.extend(&checked);
            out.extend(crc(&checked).to_be_bytes());
        }
        let mut ihdr = Vec::new();
        ihdr.extend(width.to_be_bytes());
        ihdr.extend(height.to_be_bytes());
        ihdr.extend([8, 0, 0, 0, 0]);
        let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
        chunk(&mut out, b"IHDR", &ihdr);
        chunk(&mut out, b"IDAT", &[0x78, 0x9c, 0x03, 0, 0, 0, 0, 1]);
        chunk(&mut out, b"IEND", &[]);
        out
    }

    #[test]
    fn oversized_declared_dimensions_are_rejected_before_decoding() {
        let bomb = declared_png(10_000, 10_000);
        assert!(bomb.len() < 100);
        let error = image_info(&bomb).map(|_| ()).unwrap_err();
        assert!(error.contains("40 megapixel"), "{error}");
        let error = transform_image(&bomb, &Transform::default())
            .map(|_| ())
            .unwrap_err();
        assert!(error.contains("40 megapixel"), "{error}");
        // Just inside the cap is accepted by the header check.
        assert!(image_info(&declared_png(6_000, 6_000)).is_ok());
    }
}
