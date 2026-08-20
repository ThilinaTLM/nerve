use napi_derive::napi;

use crate::platform::process;

#[napi(object)]
pub struct NativeRuntimeCapabilities {
    pub platform: String,
    pub capabilities: Vec<String>,
}

#[napi]
pub fn runtime_capabilities() -> NativeRuntimeCapabilities {
    NativeRuntimeCapabilities {
        platform: std::env::consts::OS.to_string(),
        capabilities: {
            let mut capabilities = process::capabilities();
            capabilities.push("git-read-snapshot".to_string());
            capabilities.push("git-read-ancestry".to_string());
            capabilities.push("git-read-file-diff".to_string());
            capabilities.push("git-read-repository-info".to_string());
            capabilities
        },
    }
}
