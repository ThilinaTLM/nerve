use std::{env, fs, path::PathBuf};

use anyhow::{Context as _, Result, bail};
use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderValue};
use serde::Deserialize;
use url::Url;

use crate::Options;

#[derive(Clone)]
pub(crate) struct DaemonConnection {
    pub(crate) base_url: Url,
    pub(crate) websocket_url: Url,
    token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DaemonFile {
    url: String,
}

impl std::fmt::Debug for DaemonConnection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DaemonConnection")
            .field("base_url", &self.base_url)
            .field("websocket_url", &self.websocket_url)
            .field("token", &"[REDACTED]")
            .finish()
    }
}

impl DaemonConnection {
    pub(crate) fn resolve(options: &Options) -> Result<Self> {
        if let Some(connect) = &options.connect {
            let token = options
                .token
                .clone()
                .context("--connect requires --token")?;
            return Self::from_parts(connect, token);
        }
        let home = nerve_home();
        let daemon: DaemonFile = serde_json::from_slice(
            &fs::read(home.join("daemon.json")).context("read local daemon.json")?,
        )
        .context("parse local daemon.json")?;
        let token = fs::read_to_string(home.join("auth/local-token"))
            .context("read local daemon token")?
            .trim()
            .to_owned();
        Self::from_parts(&daemon.url, token)
    }

    fn from_parts(base: &str, token: String) -> Result<Self> {
        if token.is_empty() {
            bail!("daemon token is empty");
        }
        let mut base_url = Url::parse(base).context("parse daemon URL")?;
        if !matches!(base_url.scheme(), "http" | "https") {
            bail!("daemon URL must use http or https");
        }
        base_url.set_path("");
        base_url.set_query(None);
        base_url.set_fragment(None);
        let mut websocket_url = base_url.join("ws")?;
        websocket_url
            .set_scheme(if base_url.scheme() == "https" {
                "wss"
            } else {
                "ws"
            })
            .map_err(|()| anyhow::anyhow!("invalid WebSocket URL scheme"))?;
        Ok(Self {
            base_url,
            websocket_url,
            token,
        })
    }

    #[cfg(test)]
    pub(crate) fn for_test(base: &str, token: &str) -> Result<Self> {
        Self::from_parts(base, token.to_owned())
    }

    pub(crate) fn authorize_websocket_request(
        &self,
        request: &mut http::Request<()>,
    ) -> Result<()> {
        let value = http::HeaderValue::from_str(&format!("Bearer {}", self.token))
            .context("daemon token contains invalid header characters")?;
        request
            .headers_mut()
            .insert(http::header::AUTHORIZATION, value);
        Ok(())
    }

    pub(crate) fn authorization_headers(&self) -> Result<HeaderMap> {
        let mut headers = HeaderMap::new();
        let value = HeaderValue::from_str(&format!("Bearer {}", self.token))
            .context("daemon token contains invalid header characters")?;
        headers.insert(AUTHORIZATION, value);
        Ok(headers)
    }
}

fn nerve_home() -> PathBuf {
    if let Some(value) = env::var_os("NERVE_HOME").filter(|value| !value.is_empty()) {
        return PathBuf::from(value);
    }
    env::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".nerve")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_authenticated_websocket_url() {
        let connection =
            DaemonConnection::from_parts("http://127.0.0.1:3747", "secret".into()).unwrap();
        assert_eq!(connection.websocket_url.as_str(), "ws://127.0.0.1:3747/ws");
        assert_eq!(connection.base_url.as_str(), "http://127.0.0.1:3747/");
    }

    #[test]
    fn rejects_non_http_daemon_urls() {
        assert!(DaemonConnection::from_parts("file:///tmp/daemon", "secret".into()).is_err());
    }
}
