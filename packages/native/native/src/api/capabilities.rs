use napi_derive::napi;

use crate::sys::process;

#[napi(object)]
pub struct NativeRuntimeCapabilities {
    pub platform: String,
    pub capabilities: Vec<String>,
}

#[napi]
pub fn runtime_capabilities() -> NativeRuntimeCapabilities {
    NativeRuntimeCapabilities {
        platform: std::env::consts::OS.to_string(),
        capabilities: process::capabilities(),
    }
}
