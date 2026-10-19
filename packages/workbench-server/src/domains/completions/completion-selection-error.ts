import { ApplicationError } from "../../core/application-error.js";

/** A stale issued suggestion is retryable after a new authorized search. */
export class CompletionVersionMismatchError extends ApplicationError {
  constructor() {
    super(
      409,
      "COMPLETION_VERSION_MISMATCH",
      "Suggestion expired or changed; search again",
    );
    this.name = "CompletionVersionMismatchError";
  }
}
