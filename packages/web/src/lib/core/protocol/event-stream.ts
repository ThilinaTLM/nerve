export {
  applyEventBatch,
  type ClientEventStreamState,
  createClientEventStreamState,
  type EventBatchResult,
  globalProcessedSeqFromCursor,
  markProcessed,
  processedSeqFromCursor,
  resetClientEventStreamState,
  resetClientEventStreamStateFromCursor,
} from "@nervekit/shared-ui/core/protocol/event-stream";
