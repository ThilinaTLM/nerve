export interface ResolveInteractionCommand {
  interactionId: string;
  resolutionRequestId: string;
  resolution: Record<string, unknown>;
}

export class RunConflictError extends Error {
  readonly code = "RUN_CONFLICT";
}

export class InvalidRunStateError extends Error {
  readonly code = "INVALID_RUN_STATE";
}
