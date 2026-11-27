import {
  NativeOperationError,
  normalizeNativeError,
  type NativeErrorDetail,
} from "../core/error.js";
import type { NativeGitProjectBinding } from "./project-contracts.js";
export type GitReadOperationPort = Pick<
  NativeGitProjectBinding,
  "createGitReadOperation" | "cancelGitReadOperation" | "closeGitReadOperation"
>;
export function fail(
  category: "invalid_input" | "cancelled" | "internal",
  message: string,
): never {
  throw normalizeNativeError({ category, message, retryable: false });
}

/** Rejects non-strings, empty, NUL-containing and over-4096-byte paths before N-API copies them. */
export function assertBoundedPath(
  path: unknown,
  message: string,
): asserts path is string {
  if (
    typeof path !== "string" ||
    !path ||
    Buffer.byteLength(path) > 4096 ||
    path.includes("\0")
  )
    fail("invalid_input", message);
}

/** Unwraps the native `{ value?, error? }` envelope into one error taxonomy. */
export function unwrapNative<T>(
  value: T | undefined,
  error: NativeErrorDetail | undefined,
  emptyMessage: string,
): T {
  if (error) throw normalizeNativeError(error);
  if (value === undefined) fail("internal", emptyMessage);
  return value;
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
