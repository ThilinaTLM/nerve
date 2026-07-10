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
} from "@nervekit/workbench-ui/core/protocol/event-stream";
