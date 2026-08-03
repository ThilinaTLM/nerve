use std::{fs, path::PathBuf};

use nerve_client::{
    ConversationSnapshot, EventBatchData, NerveMessage, SnapshotResponse, SubscriptionUpdatedData,
    WelcomeData, WorkspaceSnapshot,
};
use serde_json::Value;

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/contracts/test/fixtures/rust-client")
        .join(format!("{name}.json"));
    serde_json::from_str(&fs::read_to_string(path).expect("read fixture")).expect("valid JSON")
}

fn message(name: &str) -> NerveMessage<Value> {
    serde_json::from_value(fixture(name)).expect("valid Nerve message")
}

#[test]
fn deserializes_session_and_event_fixtures() {
    let hello = message("hello");
    assert_eq!(hello.kind, "hello");
    let welcome = message("welcome");
    let _: WelcomeData = serde_json::from_value(welcome.data).expect("welcome data");
    let update = message("subscription-updated");
    let _: SubscriptionUpdatedData =
        serde_json::from_value(update.data).expect("subscription data");
    let batch = message("event-batch");
    let batch: EventBatchData = serde_json::from_value(batch.data).expect("event batch");
    batch.validate_dense().expect("dense event fixture");
}

#[test]
fn deserializes_snapshot_operation_results() {
    let workspace = message("workspace-response");
    let workspace_result = workspace
        .data
        .get("result")
        .cloned()
        .expect("workspace result");
    let _: SnapshotResponse<WorkspaceSnapshot> =
        serde_json::from_value(workspace_result).expect("workspace snapshot");

    let conversation = message("conversation-response");
    let conversation_result = conversation
        .data
        .get("result")
        .cloned()
        .expect("conversation result");
    let _: SnapshotResponse<ConversationSnapshot> =
        serde_json::from_value(conversation_result).expect("conversation snapshot");
}
