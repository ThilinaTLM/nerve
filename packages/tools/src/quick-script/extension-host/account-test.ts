import { ExtensionError, type AccountInfo } from "@nervekit/extension-api";
import type { IntegrationHealthStatus } from "@nervekit/contracts/auth";
import { ToolExecutionError } from "../../execution/index.js";
import type { QuickScriptRegistry } from "../registry.js";
import { createSdkEnvironment } from "../runtime/sdk.js";
import type { ExtensionHostPorts } from "./ports.js";

/** What a kind's `test` hook found, as the health check stores it. */
export type AccountTestOutcome = {
  status: IntegrationHealthStatus;
  message?: string;
};

/** Whether an account kind of a registered extension declares a `test` hook. */
export function accountKindIsTestable(
  registry: QuickScriptRegistry,
  kind: string,
): boolean {
  return registry.extensions.some(
    (extension) => extension.definition?.accounts?.[kind]?.test !== undefined,
  );
}

/**
 * Runs the `test` hook of the account's kind with a `ctx` bound to that account:
 * every `account` setting of the kind selects it, so `ctx.http` requests with
 * `auth` sign in with its credential. Outside any conversation: no settings,
 * artifacts or report.
 *
 * An account missing what the test needs fails with `ACCOUNT_INCOMPLETE`.
 */
export async function testExtensionAccount(input: {
  registry: QuickScriptRegistry;
  /** Accounts store and diagnostics; settings are not read. */
  ports: Pick<ExtensionHostPorts, "accounts" | "log">;
  account: AccountInfo;
  signal?: AbortSignal;
}): Promise<AccountTestOutcome> {
  const { registry, ports, account } = input;
  const extension = registry.extensions.find(
    (candidate) => candidate.definition?.accounts?.[account.kind]?.test,
  );
  const definition = extension?.definition;
  const test = definition?.accounts?.[account.kind]?.test;
  if (!definition || !test)
    throw new ToolExecutionError(
      "ACCOUNT_NOT_TESTABLE",
      `Accounts of kind '${account.kind}' cannot be tested.`,
    );
  const selecting = Object.fromEntries(
    Object.entries(definition.settings.fields).flatMap(([name, field]) =>
      field.type === "account" && field.kind === account.kind
        ? [[name, account.id]]
        : [],
    ),
  );
  const env = createSdkEnvironment({
    cwd: process.cwd(),
    registry,
    signal: input.signal,
    extensionPorts: {
      ...ports,
      settings: (id) => (id === definition.id ? selecting : {}),
    },
  });
  try {
    const result = await test(account, env.extensions.context(definition));
    if (result.ok)
      return {
        status: "verified",
        ...(result.message ? { message: result.message } : {}),
      };
    return {
      status: result.reason ?? "rejected",
      message: result.fix ? `${result.message} ${result.fix}` : result.message,
    };
  } catch (error) {
    if (error instanceof ExtensionError && error.code === "BAD_REQUEST")
      throw new ToolExecutionError("ACCOUNT_INCOMPLETE", error.message);
    // A host failure on the test's own request: refused credentials or missing access.
    if (error instanceof ExtensionError)
      return {
        status:
          error.code === "UNAUTHORIZED"
            ? "rejected"
            : error.code === "FORBIDDEN"
              ? "restricted"
              : "unreachable",
        message: error.fix ? `${error.message} ${error.fix}` : error.message,
      };
    throw error;
  }
}
