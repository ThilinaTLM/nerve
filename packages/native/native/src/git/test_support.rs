//! Synthetic local-only Git fixtures. CLI is used only to prepare mutations.
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
pub(crate) struct Fixture {
    pub(crate) root: PathBuf,
    pub(crate) path: PathBuf,
}
impl Fixture {
    pub(crate) fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "nerve-git-metadata-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let path = root.join("repo");
        std::fs::create_dir_all(&path).unwrap();
        let fixture = Self { root, path };
        fixture.git(&["init", "--initial-branch=main"]);
        fixture.git(&[
            "config",
            "core.attributesFile",
            fixture.root.join("config").to_str().unwrap(),
        ]);
        fixture.git(&[
            "config",
            "core.excludesFile",
            fixture.root.join("config").to_str().unwrap(),
        ]);
        fixture.git(&[
            "config",
            "core.hooksPath",
            fixture.root.join("empty").to_str().unwrap(),
        ]);
        fixture.git(&["config", "user.name", "Synthetic"]);
        fixture.git(&["config", "user.email", "synthetic@example.invalid"]);
        fixture
    }
    pub(crate) fn git(&self, args: &[&str]) {
        let empty = self.root.join("empty");
        std::fs::create_dir_all(&empty).unwrap();
        let config = self.root.join("config");
        std::fs::write(&config, "").unwrap();
        let mut command = Command::new("git");
        command
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default());
        if let Some(root) = std::env::var_os("SystemRoot") {
            command.env("SystemRoot", root);
        }
        let output = command
            .current_dir(&self.path)
            .args([
                "-c",
                &format!("core.hooksPath={}", empty.display()),
                "-c",
                &format!("core.attributesFile={}", config.display()),
                "-c",
                "commit.gpgSign=false",
                "-c",
                "tag.gpgSign=false",
                "-c",
                "credential.helper=",
            ])
            .args(args)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_SYSTEM", &config)
            .env("GIT_CONFIG_GLOBAL", &config)
            .env("GIT_ATTR_NOSYSTEM", "1")
            .env("GIT_TEMPLATE_DIR", &empty)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    pub(crate) fn commit(&self) {
        std::fs::write(self.path.join("tracked.txt"), "base\n").unwrap();
        self.git(&["add", "."]);
        self.git(&["commit", "-qm", "initial"]);
    }
    pub(crate) fn path(&self) -> &str {
        self.path.to_str().unwrap()
    }
    #[cfg(unix)]
    pub(crate) fn selected_filter(&self) -> PathBuf {
        let marker = self.root.join("filter-marker");
        self.git(&[
            "config",
            "filter.selected.clean",
            &format!("echo executed > '{}'; cat", marker.display()),
        ]);
        std::fs::write(
            self.path.join(".gitattributes"),
            "tracked.txt filter=selected\n",
        )
        .unwrap();
        std::fs::write(self.path.join("tracked.txt"), "changed\n").unwrap();
        marker
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
pub(crate) fn write(path: impl AsRef<Path>, contents: impl AsRef<[u8]>) {
    std::fs::write(path, contents).unwrap();
}

/// Tests using the real global Git admission counter must not compete.
pub(crate) fn admission_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap()
}
