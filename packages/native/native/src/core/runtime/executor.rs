use std::sync::OnceLock;

use tokio::runtime::{Handle, Runtime};

static RUNTIME: OnceLock<Result<Runtime, String>> = OnceLock::new();

pub(crate) fn runtime() -> Result<&'static Runtime, String> {
    RUNTIME
        .get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .thread_name("nerve-native")
                .enable_all()
                .build()
                .map_err(|error| format!("Failed to initialize native async runtime: {error}"))
        })
        .as_ref()
        .map_err(Clone::clone)
}

pub(crate) fn handle() -> Result<Handle, String> {
    Ok(runtime()?.handle().clone())
}
