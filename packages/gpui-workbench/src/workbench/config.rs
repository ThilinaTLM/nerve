use std::{env, fs, path::PathBuf};

use serde::Deserialize;
use url::Url;

const DEFAULT_TARGET: &str = "http://127.0.0.1:3747";

#[derive(Clone)]
pub struct ConnectionConfig {
    pub target: Url,
    pub token: String,
}

impl std::fmt::Debug for ConnectionConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ConnectionConfig")
            .field("target", &self.target)
            .field("token", &"[redacted]")
            .finish()
    }
}

#[derive(Deserialize)]
struct DaemonMetadata {
    url: Option<String>,
    #[serde(default)]
    stale: bool,
}

pub fn discover_connection_config() -> Result<ConnectionConfig, String> {
    let home = nerve_home()?;
    let target_override = env::var("NERVE_API_TARGET")
        .ok()
        .filter(|value| !value.trim().is_empty());
    discover_from(home, target_override.as_deref())
}

fn nerve_home() -> Result<PathBuf, String> {
    if let Some(value) = env::var_os("NERVE_HOME").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(value));
    }
    let user_home = env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "HOME is not set; set NERVE_HOME to the existing Nerve home".to_string())?;
    Ok(PathBuf::from(user_home).join(".nerve"))
}

fn discover_from(home: PathBuf, target_override: Option<&str>) -> Result<ConnectionConfig, String> {
    let target = match target_override {
        Some(target) => parse_target(target)?,
        None => daemon_target(&home)?.unwrap_or_else(|| parse_target(DEFAULT_TARGET).unwrap()),
    };
    let token_path = home.join("secrets").join("daemon-token");
    let token = fs::read_to_string(&token_path)
        .map_err(|error| format!("Could not read daemon authentication metadata: {error}"))?
        .trim()
        .to_string();
    if token.is_empty() {
        return Err("Daemon authentication metadata is empty".to_string());
    }
    Ok(ConnectionConfig { target, token })
}

fn daemon_target(home: &std::path::Path) -> Result<Option<Url>, String> {
    let path = home.join("daemon.json");
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not read daemon metadata: {error}")),
    };
    let metadata: DaemonMetadata = serde_json::from_str(&raw)
        .map_err(|error| format!("Daemon metadata is invalid: {error}"))?;
    if metadata.stale {
        return Ok(None);
    }
    metadata
        .url
        .filter(|url| !url.trim().is_empty())
        .map(|url| parse_target(&url))
        .transpose()
}

fn parse_target(value: &str) -> Result<Url, String> {
    let mut target = Url::parse(value.trim())
        .map_err(|error| format!("Workbench server URL is invalid: {error}"))?;
    if !matches!(target.scheme(), "http" | "https") || target.host_str().is_none() {
        return Err("Workbench server URL must be an absolute http(s) URL".to_string());
    }
    let normalized_path = target.path().trim_end_matches('/').to_string();
    target.set_path(&normalized_path);
    target.set_query(None);
    target.set_fragment(None);
    Ok(target)
}

impl ConnectionConfig {
    pub fn client_config_url(&self) -> Url {
        self.target
            .join("/api/client-config")
            .expect("validated server target joins client-config path")
    }

    pub fn display_target(&self) -> String {
        self.target.as_str().trim_end_matches('/').to_string()
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use super::*;

    fn temp_home(label: &str) -> PathBuf {
        let path = env::temp_dir().join(format!("nerve-gpui-{label}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(path.join("secrets")).unwrap();
        fs::write(path.join("secrets/daemon-token"), "nt_test\n").unwrap();
        path
    }

    fn cleanup(path: &Path) {
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn explicit_target_takes_precedence() {
        let home = temp_home("explicit");
        fs::write(
            home.join("daemon.json"),
            r#"{"url":"http://127.0.0.1:4999"}"#,
        )
        .unwrap();

        let config = discover_from(home.clone(), Some("http://127.0.0.1:4888/")).unwrap();
        assert_eq!(config.display_target(), "http://127.0.0.1:4888");
        assert_eq!(config.token, "nt_test");
        cleanup(&home);
    }

    #[test]
    fn uses_non_stale_daemon_metadata() {
        let home = temp_home("metadata");
        fs::write(
            home.join("daemon.json"),
            r#"{"url":"http://127.0.0.1:4777","stale":false}"#,
        )
        .unwrap();

        let config = discover_from(home.clone(), None).unwrap();
        assert_eq!(config.display_target(), "http://127.0.0.1:4777");
        cleanup(&home);
    }

    #[test]
    fn stale_or_missing_metadata_uses_default_target() {
        for body in [
            None,
            Some(r#"{"url":"http://127.0.0.1:4777","stale":true}"#),
        ] {
            let home = temp_home("default");
            if let Some(body) = body {
                fs::write(home.join("daemon.json"), body).unwrap();
            }
            let config = discover_from(home.clone(), None).unwrap();
            assert_eq!(config.display_target(), DEFAULT_TARGET);
            cleanup(&home);
        }
    }

    #[test]
    fn missing_and_empty_tokens_are_errors() {
        let missing = temp_home("missing-token");
        fs::remove_file(missing.join("secrets/daemon-token")).unwrap();
        assert!(discover_from(missing.clone(), None).is_err());
        cleanup(&missing);

        let empty = temp_home("empty-token");
        fs::write(empty.join("secrets/daemon-token"), "\n").unwrap();
        assert!(discover_from(empty.clone(), None).is_err());
        cleanup(&empty);
    }

    #[test]
    fn rejects_non_http_targets() {
        let home = temp_home("bad-url");
        let error = discover_from(home.clone(), Some("file:///tmp/server")).unwrap_err();
        assert!(error.contains("http(s)"));
        cleanup(&home);
    }
}
