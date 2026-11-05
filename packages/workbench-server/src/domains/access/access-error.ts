import type { AccessErrorCode } from "@nervekit/contracts/access";
import { ApplicationError } from "../../core/application-error.js";

export class AccessError extends ApplicationError {
  constructor(
    status: number,
    readonly accessCode: AccessErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(status, accessCode, message);
    this.name = "AccessError";
  }
}
