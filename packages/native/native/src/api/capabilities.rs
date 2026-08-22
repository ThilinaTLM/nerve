use napi::bindgen_prelude::Result;
use napi_derive::napi;

use crate::platform::process;

#[napi(object)]
pub struct NativeRuntimeCapabilities {
    pub platform: String,
    pub capabilities: Vec<String>,
}

#[napi(object)]
pub struct NativeManagedProcessHostOptions {
    pub delegated_scope: Option<bool>,
    pub allow_uncontained: Option<bool>,
}

#[napi(object)]
pub struct NativeManagedProcessHostStatus {
    pub backend: String,
    pub hard_limits_available: bool,
    pub enforcement: String,
    pub detail: Option<String>,
}

#[napi]
pub fn initialize_managed_process_host(
    options: NativeManagedProcessHostOptions,
) -> Result<NativeManagedProcessHostStatus> {
    let status = process::initialize_managed_process_host(
        options.delegated_scope.unwrap_or(false),
        options.allow_uncontained.unwrap_or(false),
    )
    .map_err(napi::Error::from_reason)?;
    Ok(NativeManagedProcessHostStatus {
        backend: status.backend,
        hard_limits_available: status.hard_limits_available,
        enforcement: status.enforcement,
        detail: status.detail,
    })
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
