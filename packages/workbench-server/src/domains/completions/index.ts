export {
  discoverCandidates,
  type FileCompletionCandidate,
} from "./file-completion-candidates.js";
export { UnifiedCompletionService } from "./unified-completion-service.js";
export {
  createCompletionProviders,
  mergeCompletionRemoteSnapshots,
  type CompletionSourcePorts,
  type CompletionRemoteSnapshot,
} from "./completion-source-providers.js";
export { createCompletionContextReader } from "./completion-context-reader.js";
export type {
  CompletionServiceDependencies,
  CompletionProvider,
  CompletionDocument,
} from "./completion-provider.js";
