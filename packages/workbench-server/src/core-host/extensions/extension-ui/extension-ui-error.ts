import type { BridgeErrorCode } from "@nervekit/contracts/extensions";
import { ApplicationError } from "../../../core/application-error.js";

const statusOf: Record<BridgeErrorCode, number> = {
  invalid_request: 400,
  not_allowed: 403,
  unknown_method: 400,
  not_found: 404,
  too_large: 413,
  cancelled: 400,
  backend_error: 502,
  conflict: 409,
  failed: 500,
};

/**
 * A failed bridge request. `details.bridgeCode` is the `BridgeErrorCode` the app answers the
 * frame with; the message is safe to show the frame (it never contains paths outside the project
 * or secrets).
 */
export class ExtensionUiError extends ApplicationError {
  constructor(
    readonly bridgeCode: BridgeErrorCode,
    message: string,
  ) {
    super(
      statusOf[bridgeCode],
      `EXTENSION_UI_${bridgeCode.toUpperCase()}`,
      message,
      {
        retryable: false,
        details: { bridgeCode },
      },
    );
  }
}
