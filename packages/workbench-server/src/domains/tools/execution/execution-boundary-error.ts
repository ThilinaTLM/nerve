/** A definitive authorization failure before any external execution claim. */
export class ToolExecutionBoundaryError extends Error {
  readonly code = "TOOL_APPROVAL_STALE";
}
