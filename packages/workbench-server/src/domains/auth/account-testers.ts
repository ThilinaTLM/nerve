import { testExtensionAccount } from "@nervekit/tools/extension-host";
import { type QuickScriptRegistry } from "@nervekit/tools/quick-script";
import { ToolExecutionError } from "@nervekit/tools/execution";
import { ApplicationError } from "../../core/application-error.js";
import { accountPorts } from "../accounts/account-ports.js";
import type { AccountsReader } from "../accounts/accounts.service.js";
import type { AccountTester } from "./integration-health.service.js";

/**
 * Checks an account through its kind's `test` hook, run by the extension host
 * with a `ctx` bound to the account. An account missing what the test needs
 * (a site URL) is a client error, not a stored result.
 */
export function extensionAccountTester(input: {
  /** Where the kinds come from: a registry, or a provider of the user-level one (built-ins and user extensions). */
  registry: QuickScriptRegistry | (() => Promise<QuickScriptRegistry>);
  accounts: AccountsReader;
  warn?: (extensionId: string, message: string, data?: unknown) => void;
}): AccountTester {
  const { accounts, warn } = input;
  return async (account) => {
    try {
      return await testExtensionAccount({
        registry:
          typeof input.registry === "function"
            ? await input.registry()
            : input.registry,
        account,
        ports: {
          accounts: accountPorts(accounts),
          log: (level, extensionId, message, data) => {
            if (level === "warn") warn?.(extensionId, message, data);
          },
        },
      });
    } catch (error) {
      if (
        error instanceof ToolExecutionError &&
        error.code === "ACCOUNT_INCOMPLETE"
      )
        throw new ApplicationError(400, "ACCOUNT_INCOMPLETE", error.message);
      throw error;
    }
  };
}
