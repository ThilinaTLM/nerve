mod auth;
mod client;
mod config;
mod contracts;
mod http;
mod session;

pub use auth::Secret;
pub use client::{ClientEvent, ClientHandle, ConnectionState};
pub use config::{
    ConnectionConfig, ConnectionOptions, ConnectionSource, discover_local, normalize_origin,
    resolve_connection,
};
pub use contracts::*;
pub use http::HttpClient;
pub use session::{ClientSession, SessionState};

use serde::Serialize;
use serde_json::Value;
use thiserror::Error;

pub type Result<T> = std::result::Result<T, ClientError>;

#[derive(Debug, Error)]
pub enum ClientError {
    #[error("configuration error: {0}")]
    Configuration(String),
    #[error("daemon authorization failed")]
    Unauthorized,
    #[error("daemon returned HTTP status {0}")]
    HttpStatus(u16),
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("snapshot required for {0}")]
    SnapshotRequired(String),
    #[error("network request failed: {0}")]
    Network(#[from] reqwest::Error),
    #[error("WebSocket failed: {0}")]
    WebSocket(#[from] tokio_tungstenite::tungstenite::Error),
    #[error("URL error: {0}")]
    Url(#[from] url::ParseError),
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn new_message<T: Serialize>(
    kind: &str,
    source: PeerDescriptor,
    target: PeerDescriptor,
    data: T,
) -> NerveMessage<Value> {
    NerveMessage {
        protocol: "nerve".into(),
        version: 1,
        id: format!("msg_{}", uuid::Uuid::new_v4().simple()),
        kind: kind.into(),
        ts: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        source,
        target,
        correlation_id: None,
        causation_id: None,
        trace_id: None,
        reply_to: None,
        meta: None,
        data: serde_json::to_value(data).expect("serializable protocol data"),
    }
}
