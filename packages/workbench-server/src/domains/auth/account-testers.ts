import {
  testExtensionAccount,
  type QuickScriptRegistry,
} from "@nervekit/tools/quick-script";
import { ToolExecutionError } from "@nervekit/tools/execution";
import { ApplicationError } from "../../core/application-error.js";
import type { AccountsReader } from "../accounts/accounts.service.js";
import type { AccountTester } from "./integration-health.service.js";

/**
 * Checks an account through its kind's `test` hook, run by the extension host
 * with a `ctx` bound to the account. An account missing what the test needs
 * (a site URL) is a client error, not a stored result.
 */
export function extensionAccountTester(input: {
  registry: QuickScriptRegistry;
  accounts: AccountsReader;
  warn?: (extensionId: string, message: string, data?: unknown) => void;
}): AccountTester {
  const { registry, accounts, warn } = input;
  return async (account) => {
    try {
      return await testExtensionAccount({
        registry,
        account,
        ports: {
          accounts: {
            get: async (kind, id) => await accounts.get(kind, id),
            secret: async (kind, id) => await accounts.secret(kind, id),
          },
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
