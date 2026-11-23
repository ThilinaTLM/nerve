import { agentTextLimits } from "@nervekit/contracts/extensions";
import type {
  ExtensionCode,
  ExtensionCodeAdapter,
} from "@nervekit/tools/extension-host";
import type { ExtensionDefinition } from "@nervekit/extension-api";

/** Cuts a text to `limit` characters, saying so. */
export function truncateAgentText(
  text: string,
  limit: number = agentTextLimits.errorMessage,
): string {
  return text.length <= limit
    ? text
    : `${text.slice(0, limit - 1)}… [cut at ${limit} characters]`;
}

function shortenError(error: unknown): unknown {
  if (error instanceof Error) {
    error.message = truncateAgentText(error.message);
    const fix = (error as { fix?: unknown }).fix;
    if (typeof fix === "string")
      (error as { fix?: string }).fix = truncateAgentText(fix);
  }
  return error;
}

const guardedBase = (
  run: () => Promise<unknown>,
  record?: (operation: string, error: unknown) => void,
  operation = "",
) =>
  run().catch((error) => {
    record?.(operation, error);
    throw shortenError(error);
  });

/** The code adapter, with the errors of installed extensions' code cut to `agentTextLimits.errorMessage`. */
export function limitInstalledErrors(
  adapter: ExtensionCodeAdapter,
  installed: (definition: ExtensionDefinition) => boolean,
  /** Told of every failure of an installed extension's code (before it is cut). */
  record?: (
    definition: ExtensionDefinition,
    operation: string,
    error: unknown,
  ) => void,
): ExtensionCodeAdapter {
  return {
    async open(definition, host) {
      const code = await adapter.open(definition, host);
      if (!installed(definition)) return code;
      const guarded = (operation: string, run: () => Promise<unknown>) =>
        guardedBase(
          run,
          record && ((op, error) => record(definition, op, error)),
          operation,
        );
      const limited: ExtensionCode = {
        parse: (...args) => guarded("parse", () => code.parse(...args)),
        authorize: (...args) =>
          guarded("authorize", () => code.authorize(...args)) as ReturnType<
            ExtensionCode["authorize"]
          >,
        resource: (...args) =>
          guarded("resource", () => code.resource(...args)) as ReturnType<
            ExtensionCode["resource"]
          >,
        run: (...args) => guarded("run", () => code.run(...args)),
        present: (...args) =>
          guarded("present", () => code.present(...args)) as ReturnType<
            ExtensionCode["present"]
          >,
        configuration: (...args) =>
          guarded("configuration", () =>
            code.configuration(...args),
          ) as ReturnType<ExtensionCode["configuration"]>,
        availability: (...args) =>
          guarded("availability", () =>
            code.availability(...args),
          ) as ReturnType<ExtensionCode["availability"]>,
        testAccount: (...args) =>
          guarded("testAccount", () => code.testAccount(...args)) as ReturnType<
            ExtensionCode["testAccount"]
          >,
        dispose: () => code.dispose(),
      };
      return limited;
    },
  };
}
