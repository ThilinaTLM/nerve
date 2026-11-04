use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// Fresh empty directory under the system temp dir (not auto-removed).
pub(crate) fn tempdir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "nerve-native-{name}-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir.canonicalize().unwrap()
}
