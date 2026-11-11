use super::transform::{Crop, Fit, Info, Resize, Transform, Transformed};
use super::{Format, MAX_INPUT_BYTES, Options, Prepared, image_info, prepare, transform_image};
use napi::Env;
use napi::bindgen_prelude::{AsyncTask, Buffer, Result, Task};
use napi_derive::napi;

#[napi(object)]
pub struct NativePrepareImageOptions {
    pub max_dimension: u32,
    pub max_base64_bytes: f64,
    /// "png" | "jpeg" | "gif" | "webp"; formats that may pass through unchanged.
    pub accepted_formats: Vec<String>,
    /// "png" | "jpeg"; formats used when re-encoding, in preference order.
    pub output_formats: Vec<String>,
}

#[napi(object)]
pub struct NativePreparedImage {
    pub data: Buffer,
    pub mime_type: String,
    pub width: u32,
    pub height: u32,
    pub changed: bool,
}

pub struct PrepareImageTask {
    data: Buffer,
    options: Options,
}

impl Task for PrepareImageTask {
    type Output = Prepared;
    type JsValue = NativePreparedImage;

    fn compute(&mut self) -> Result<Self::Output> {
        prepare(&self.data, &self.options).map_err(napi::Error::from_reason)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(NativePreparedImage {
            data: output.data.into(),
            mime_type: output.format.mime().to_string(),
            width: output.width,
            height: output.height,
            changed: output.changed,
        })
    }
}

fn formats(names: &[String]) -> Result<Vec<Format>> {
    names
        .iter()
        .map(|name| Format::parse(name).map_err(napi::Error::from_reason))
        .collect()
}

#[napi]
pub fn prepare_model_image(
    data: Buffer,
    options: NativePrepareImageOptions,
) -> Result<AsyncTask<PrepareImageTask>> {
    if data.len() > MAX_INPUT_BYTES {
        return Err(napi::Error::from_reason("Image exceeds the input limit"));
    }
    if !(options.max_base64_bytes.is_finite() && options.max_base64_bytes >= 1.0) {
        return Err(napi::Error::from_reason("Invalid maxBase64Bytes"));
    }
    let options = Options {
        max_dimension: options.max_dimension,
        max_base64_bytes: options.max_base64_bytes as usize,
        accepted_formats: formats(&options.accepted_formats)?,
        output_formats: formats(&options.output_formats)?,
    };
    Ok(AsyncTask::new(PrepareImageTask { data, options }))
}

#[napi(object)]
pub struct NativeCrop {
    pub left: u32,
    pub top: u32,
    pub width: u32,
    pub height: u32,
}

#[napi(object)]
pub struct NativeResize {
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// "inside" (default) | "cover" | "fill"
    pub fit: Option<String>,
}

#[napi(object)]
pub struct NativeTransformOptions {
    pub crop: Option<NativeCrop>,
    pub resize: Option<NativeResize>,
    /// "png" | "jpeg"
    pub format: Option<String>,
    /// 1-100; JPEG only.
    pub quality: Option<u32>,
}

#[napi(object)]
pub struct NativeTransformedImage {
    pub data: Buffer,
    pub format: String,
    pub width: u32,
    pub height: u32,
}

#[napi(object)]
pub struct NativeImageInfo {
    pub format: String,
    pub width: u32,
    pub height: u32,
}

pub struct TransformImageTask {
    data: Buffer,
    ops: Transform,
}

impl Task for TransformImageTask {
    type Output = Transformed;
    type JsValue = NativeTransformedImage;

    fn compute(&mut self) -> Result<Self::Output> {
        transform_image(&self.data, &self.ops).map_err(napi::Error::from_reason)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(NativeTransformedImage {
            data: output.data.into(),
            format: output.format.name().to_string(),
            width: output.width,
            height: output.height,
        })
    }
}

pub struct ImageInfoTask {
    data: Buffer,
}

impl Task for ImageInfoTask {
    type Output = Info;
    type JsValue = NativeImageInfo;

    fn compute(&mut self) -> Result<Self::Output> {
        image_info(&self.data).map_err(napi::Error::from_reason)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(NativeImageInfo {
            format: output.format.name().to_string(),
            width: output.width,
            height: output.height,
        })
    }
}

#[napi]
pub fn transform_image_native(
    data: Buffer,
    options: NativeTransformOptions,
) -> Result<AsyncTask<TransformImageTask>> {
    let quality = options
        .quality
        .map(|q| u8::try_from(q).map_err(|_| napi::Error::from_reason("Invalid quality")))
        .transpose()?;
    let ops = Transform {
        crop: options.crop.map(|c| Crop {
            left: c.left,
            top: c.top,
            width: c.width,
            height: c.height,
        }),
        resize: options
            .resize
            .map(|r| {
                Ok::<_, napi::Error>(Resize {
                    width: r.width,
                    height: r.height,
                    fit: match r.fit {
                        Some(name) => Fit::parse(&name).map_err(napi::Error::from_reason)?,
                        None => Fit::Inside,
                    },
                })
            })
            .transpose()?,
        format: options
            .format
            .map(|name| Format::parse(&name).map_err(napi::Error::from_reason))
            .transpose()?,
        quality,
    };
    Ok(AsyncTask::new(TransformImageTask { data, ops }))
}

#[napi]
pub fn image_info_native(data: Buffer) -> AsyncTask<ImageInfoTask> {
    AsyncTask::new(ImageInfoTask { data })
}
