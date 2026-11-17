import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { resolveToolPath } from "../../execution/index.js";
import type { QuickScriptRegistry } from "../registry.js";
import { createSdkEnvironment } from "../runtime/sdk.js";
import type { NestedCheck } from "../runtime/sdk-types.js";
import { declaredReadPaths } from "./from-definition.js";
import type { ExtensionHostPorts } from "./ports.js";

/** What went wrong in a call from an extension's UI, in a form the bridge maps to an error code. */
export class ExtensionUiCallError extends Error {
  constructor(
    readonly code: "not_found" | "failed" | "backend_error",
    message: string,
  ) {
    super(message);
  }
}

export type ExtensionUiCall = {
  registry: QuickScriptRegistry;
  extensionId: string;
  /** `namespace.method` as declared by the extension. */
  method: string;
  /** What the UI passed: the method receives it as its single argument (none: no arguments). */
  args?: unknown;
  /** The open project; the method's file reads are limited to it. */
  projectDir: string;
  ports: ExtensionHostPorts;
  timeoutMs?: number;
};

export const defaultUiCallTimeoutMs = 60_000;

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Runs one of an extension's own backend methods for its UI: the user's action, outside any
 * conversation. No permission rule applies (the consent the user gave covers it) but the `ctx`
 * rules do: credentials stay host side, the network is the manifest's allowlist, and file reads
 * the method declares must stay inside the open project. The method belongs to the extension.
 */
export async function callExtensionMethodFromUi(
  call: ExtensionUiCall,
): Promise<unknown> {
  const extension = call.registry.extensions.find(
    (candidate) => candidate.id === call.extensionId,
  );
  const definition = extension?.definition;
  const dot = call.method.indexOf(".");
  const namespace = dot > 0 ? call.method.slice(0, dot) : "";
  const path = dot > 0 ? call.method.slice(dot + 1) : "";
  if (
    !definition ||
    !definition.namespaces.some(
      (candidate) =>
        candidate.id === namespace && Object.hasOwn(candidate.methods, path),
    )
  )
    throw new ExtensionUiCallError(
      "not_found",
      `${call.method} is not a method of ${call.extensionId}`,
    );
  const method = call.registry.methods.find(
    (candidate) => candidate.product === namespace && candidate.path === path,
  );
  if (!method)
    throw new ExtensionUiCallError(
      "not_found",
      `${call.method} is not available`,
    );

  const controller = new AbortController();
  const env = createSdkEnvironment({
    cwd: call.projectDir,
    registry: call.registry,
    extensionPorts: call.ports,
    signal: controller.signal,
    // No permission engine: a method's own checks are the user's consent, not a prompt.
    authorizeNested: async () => {},
  });
  const timeout = setTimeout(
    () => controller.abort(),
    call.timeoutMs ?? defaultUiCallTimeoutMs,
  );
  const aborted = new Promise<never>((_, reject) =>
    controller.signal.addEventListener("abort", () =>
      reject(new ExtensionUiCallError("failed", `${call.method} timed out`)),
    ),
  );
  aborted.catch(() => {});
  try {
    const run = (async () => {
      const prepared = await method.prepare(
        call.args === undefined ? [] : [call.args],
        env,
      );
      const checks = [
        prepared.authorization,
        ...(prepared.additionalAuthorizations ?? []),
      ].filter((check): check is NestedCheck => check !== undefined);
      const root = realOrSelf(call.projectDir);
      for (const read of declaredReadPaths(checks)) {
        const resolved = resolveToolPath(call.projectDir, read);
        if (!inside(root, realOrSelf(resolved)))
          throw new ExtensionUiCallError(
            "failed",
            `${call.method} reads ${read}, which is outside the open project`,
          );
      }
      return await prepared.run(env);
    })();
    return await Promise.race([run, aborted]);
  } catch (error) {
    if (error instanceof ExtensionUiCallError) throw error;
    throw new ExtensionUiCallError(
      "backend_error",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await env.extensions.dispose();
  }
}
