import { NativeOperationError, normalizeNativeError } from "../core/error.js";
import type { NativeGitProjectBinding } from "./project-contracts.js";
export type GitReadOperationPort = Pick<
  NativeGitProjectBinding,
  "createGitReadOperation" | "cancelGitReadOperation" | "closeGitReadOperation"
>;
function fail(category: "cancelled" | "internal", message: string): never {
  throw normalizeNativeError({ category, message, retryable: false });
}
export async function withGitReadOperation<T>(
  port: GitReadOperationPort,
  signal: AbortSignal | undefined,
  run: (handle: number) => Promise<T>,
): Promise<T> {
  if (signal?.aborted) fail("cancelled", "Git read cancelled");
  let created: ReturnType<GitReadOperationPort["createGitReadOperation"]>;
  try {
    created = port.createGitReadOperation();
  } catch {
    return fail("internal", "Native Git read admission failed");
  }
  if (created.error) throw normalizeNativeError(created.error);
  const handle = created.handle;
  if (handle === undefined) fail("internal", "Native Git operation was empty");
  const abort = () => port.cancelGitReadOperation(handle);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    // Handle an abort between initial check and listener installation.
    if (signal?.aborted) abort();
    const result = await run(handle);
    // A late abort must not let superseded data escape to the caller.
    if (signal?.aborted) fail("cancelled", "Git read cancelled");
    return result;
  } catch (error) {
    if (error instanceof NativeOperationError) throw error;
    return fail("internal", "Native Git read failed");
  } finally {
    signal?.removeEventListener("abort", abort);
    port.closeGitReadOperation(handle);
  }
}
