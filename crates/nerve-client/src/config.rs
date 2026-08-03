use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde::Deserialize;
use url::Url;

use crate::{ClientError, Result, Secret};

#[derive(Clone, Debug)]
pub struct ConnectionConfig {
    pub origin: Url,
    pub token: Secret,
    pub source: ConnectionSource,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConnectionSource {
    Explicit,
    LocalDiscovery,
}

#[derive(Clone, Debug, Default)]
pub struct ConnectionOptions {
    pub connect: Option<String>,
    pub token: Option<String>,
    pub nerve_home: Option<PathBuf>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DaemonFile {
    url: String,
}

pub fn resolve_connection(options: &ConnectionOptions) -> Result<ConnectionConfig> {
    if let Some(connect) = options.connect.as_deref() {
        let token = options
            .token
            .clone()
            .or_else(|| env::var("NERVE_DAEMON_TOKEN").ok())
            .ok_or_else(|| {
                ClientError::Configuration(
                    "remote connections require --token or NERVE_DAEMON_TOKEN".into(),
                )
            })?;
        return Ok(ConnectionConfig {
            origin: normalize_origin(connect)?,
            token: Secret::new(token)?,
            source: ConnectionSource::Explicit,
        });
    }

    let home = options
        .nerve_home
        .clone()
        .or_else(|| env::var_os("NERVE_HOME").map(PathBuf::from))
        .unwrap_or_else(default_nerve_home);
    discover_local(&home)
}

pub fn discover_local(home: &Path) -> Result<ConnectionConfig> {
    let daemon_path = home.join("daemon.json");
    let token_path = home.join("auth").join("local-token");
    let daemon_raw = fs::read_to_string(&daemon_path).map_err(|error| {
        ClientError::Configuration(format!("cannot read {}: {error}", daemon_path.display()))
    })?;
    let daemon: DaemonFile = serde_json::from_str(&daemon_raw).map_err(|error| {
        ClientError::Configuration(format!("invalid {}: {error}", daemon_path.display()))
    })?;
    let token = fs::read_to_string(&token_path).map_err(|error| {
        ClientError::Configuration(format!("cannot read {}: {error}", token_path.display()))
    })?;
    Ok(ConnectionConfig {
        origin: normalize_origin(&daemon.url)?,
        token: Secret::new(token)?,
        source: ConnectionSource::LocalDiscovery,
    })
}

pub fn normalize_origin(input: &str) -> Result<Url> {
    let mut url = Url::parse(input)
        .map_err(|error| ClientError::Configuration(format!("invalid daemon URL: {error}")))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(ClientError::Configuration(
            "daemon URL must be an http(s) origin".into(),
        ));
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(ClientError::Configuration(
            "daemon URL must not contain credentials, query, or fragment".into(),
        ));
    }
    url.set_path("/");
    Ok(url)
}

fn default_nerve_home() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".nerve")
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{
        ConnectionOptions, ConnectionSource, discover_local, normalize_origin, resolve_connection,
    };

    #[test]
    fn normalizes_origin_and_rejects_secrets() {
        assert_eq!(
            normalize_origin("http://127.0.0.1:3747/path")
                .unwrap()
                .as_str(),
            "http://127.0.0.1:3747/"
        );
        assert!(normalize_origin("ws://127.0.0.1:3747").is_err());
        assert!(normalize_origin("http://user:pass@localhost").is_err());
        assert!(normalize_origin("http://localhost?token=x").is_err());
    }

    #[test]
    fn discovers_local_profile() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("auth")).unwrap();
        fs::write(
            dir.path().join("daemon.json"),
            r#"{"url":"http://127.0.0.1:3747"}"#,
        )
        .unwrap();
        fs::write(dir.path().join("auth/local-token"), "secret\n").unwrap();
        let config = discover_local(dir.path()).unwrap();
        assert_eq!(config.source, ConnectionSource::LocalDiscovery);
        assert_eq!(config.origin.as_str(), "http://127.0.0.1:3747/");
        assert!(!format!("{config:?}").contains("secret"));
    }

    #[test]
    fn explicit_connection_wins() {
        let config = resolve_connection(&ConnectionOptions {
            connect: Some("https://example.test/some/path".into()),
            token: Some("secret".into()),
            nerve_home: Some("/does/not/exist".into()),
        })
        .unwrap();
        assert_eq!(config.source, ConnectionSource::Explicit);
        assert_eq!(config.origin.as_str(), "https://example.test/");
    }
}
