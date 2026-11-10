use super::{Format, MAX_INPUT_BYTES, Options, Prepared, prepare};
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
