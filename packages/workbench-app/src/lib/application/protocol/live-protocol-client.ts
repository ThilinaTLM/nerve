import type {
  OperationName,
  OperationParams,
  OperationResult,
} from "@nervekit/contracts/operations";
import type { ProtocolRequestData } from "@nervekit/contracts/wire";

export type LiveProtocolRequestOptions = Pick<
  ProtocolRequestData,
  "idempotencyKey" | "timeoutMs" | "expect"
>;

export interface LiveProtocolRequester {
  isReady(): boolean;
  request<M extends OperationName>(
    method: M,
    params: OperationParams<M>,
    options?: LiveProtocolRequestOptions,
  ): Promise<OperationResult<M>>;
}

export class LiveProtocolSessionUnavailableError extends Error {
  constructor() {
    super("A live protocol session is required");
    this.name = "LiveProtocolSessionUnavailableError";
  }
}

let requester: LiveProtocolRequester | undefined;

export function installLiveProtocolRequester(
  next: LiveProtocolRequester,
): () => void {
  requester = next;
  return () => {
    if (requester === next) requester = undefined;
  };
}

export function isLiveProtocolReady(): boolean {
  return requester?.isReady() ?? false;
}

export function requestLiveProtocol<M extends OperationName>(
  method: M,
  params: OperationParams<M>,
  options?: LiveProtocolRequestOptions,
): Promise<OperationResult<M>> {
  if (!requester?.isReady()) {
    return Promise.reject(new LiveProtocolSessionUnavailableError());
  }
  return requester.request(method, params, options);
}
