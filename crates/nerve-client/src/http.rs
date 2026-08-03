use std::time::Duration;

use reqwest::header::{ACCEPT, CONTENT_TYPE};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use url::Url;

use crate::{
    ClientError, ConnectionConfig, ConversationSnapshot, NerveMessage, PeerDescriptor, Result,
    SnapshotResponse, WorkspaceSnapshot, new_message,
};

const MEDIA_TYPE: &str = "application/vnd.nerve.protocol.v1+json";
const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone)]
pub struct HttpClient {
    config: ConnectionConfig,
    client: reqwest::Client,
    source: PeerDescriptor,
}

impl HttpClient {
    pub fn new(config: ConnectionConfig, source: PeerDescriptor) -> Result<Self> {
        let client = reqwest::Client::builder()
            .default_headers(config.token.authorization_headers()?)
            .timeout(Duration::from_secs(30))
            .build()?;
        Ok(Self {
            config,
            client,
            source,
        })
    }

    pub async fn health(&self) -> Result<Value> {
        let response = self.client.get(self.endpoint("api/status")?).send().await?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(ClientError::Unauthorized);
        }
        if !response.status().is_success() {
            return Err(ClientError::HttpStatus(response.status().as_u16()));
        }
        limited_json(response).await
    }

    pub async fn workspace_snapshot(&self) -> Result<SnapshotResponse<WorkspaceSnapshot>> {
        self.protocol_request("snapshot.workspace.get", json!({}))
            .await
    }

    pub async fn conversation_snapshot(
        &self,
        conversation_id: &str,
    ) -> Result<SnapshotResponse<ConversationSnapshot>> {
        self.protocol_request(
            "snapshot.conversation.get",
            json!({ "conversationId": conversation_id }),
        )
        .await
    }

    pub async fn protocol_request<T: DeserializeOwned>(
        &self,
        method: &str,
        params: Value,
    ) -> Result<T> {
        let request = new_message(
            "request",
            self.source.clone(),
            PeerDescriptor::server(),
            json!({ "method": method, "params": params }),
        );
        let request_id = request.id.clone();
        let response = self
            .client
            .post(self.endpoint("api/protocol/v1")?)
            .header(CONTENT_TYPE, MEDIA_TYPE)
            .header(ACCEPT, format!("{MEDIA_TYPE}, application/json"))
            .json(&request)
            .send()
            .await?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(ClientError::Unauthorized);
        }
        let status = response.status();
        let envelope: NerveMessage<Value> = limited_json(response).await?;
        validate_envelope(&envelope)?;
        if envelope.reply_to.as_deref() != Some(request_id.as_str()) {
            return Err(ClientError::Protocol(
                "response replyTo does not match request".into(),
            ));
        }
        if envelope.kind == "error" {
            let message = envelope
                .data
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("protocol request failed");
            return Err(ClientError::Protocol(message.into()));
        }
        if !status.is_success() {
            return Err(ClientError::HttpStatus(status.as_u16()));
        }
        if envelope.kind != "response" {
            return Err(ClientError::Protocol(format!(
                "expected response, received {}",
                envelope.kind
            )));
        }
        let response_method = envelope.data.get("method").and_then(Value::as_str);
        if response_method != Some(method) {
            return Err(ClientError::Protocol(
                "response method does not match request".into(),
            ));
        }
        let result = envelope
            .data
            .get("result")
            .cloned()
            .ok_or_else(|| ClientError::Protocol("response has no result".into()))?;
        serde_json::from_value(result).map_err(ClientError::from)
    }

    fn endpoint(&self, path: &str) -> Result<Url> {
        self.config.origin.join(path).map_err(ClientError::from)
    }
}

pub(crate) fn validate_envelope(message: &NerveMessage<Value>) -> Result<()> {
    if message.protocol != "nerve" || message.version != 1 {
        return Err(ClientError::Protocol(
            "unsupported protocol envelope".into(),
        ));
    }
    Ok(())
}

async fn limited_json<T: DeserializeOwned>(response: reqwest::Response) -> Result<T> {
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
    {
        return Err(ClientError::Protocol(
            "HTTP response exceeds size limit".into(),
        ));
    }
    let bytes = response.bytes().await?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(ClientError::Protocol(
            "HTTP response exceeds size limit".into(),
        ));
    }
    serde_json::from_slice(&bytes).map_err(ClientError::from)
}
