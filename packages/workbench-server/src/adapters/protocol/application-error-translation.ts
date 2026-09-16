import type {
  NerveErrorCode,
  ProtocolErrorData,
} from "@nervekit/contracts/wire";
import { ApplicationError } from "../../core/application-error.js";

export function translateApplicationError(
  error: ApplicationError,
): ProtocolErrorData {
  return {
    code: protocolCodeForHttpError(error.status, error.code),
    message: error.message,
    retryable:
      error.options.retryable ?? (error.status === 429 || error.status >= 500),
  };
}

export function protocolCodeForHttpError(
  status: number,
  code: string,
): NerveErrorCode {
  switch (status) {
    case 401:
      return "AUTH_REQUIRED";
    case 403:
      return code.includes("POLICY") ? "POLICY_DENIED" : "AUTH_FORBIDDEN";
    case 404:
      return "RESOURCE_NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 422:
      return "DOMAIN_VALIDATION_FAILED";
    case 429:
      return "RATE_LIMITED";
    case 503:
      return "SERVICE_UNAVAILABLE";
    case 504:
      return "OPERATION_TIMEOUT";
    default:
      if (code.endsWith("_NOT_FOUND")) return "RESOURCE_NOT_FOUND";
      if (code.includes("POLICY")) return "POLICY_DENIED";
      if (code.includes("CONFLICT")) return "CONFLICT";
      return "INTERNAL_ERROR";
  }
}
