import type { InstalledExtensionManifest } from "@nervekit/contracts/extensions";
import type {
  ExtensionCode,
  ExtensionCodeAdapter,
} from "@nervekit/tools/quick-script";
import type { ExtensionDefinition } from "@nervekit/extension-api";

/**
 * Size limits on the text installed extensions put in front of a model (docs/agent-facing.md:
 * descriptions are an index, detail is read on demand). The description of `quick_script` is read
 * on every turn, so static text that is over its limit is rejected when the extension loads, with
 * the limit in the diagnostic. Error messages exist only at run time and are cut, not rejected.
 */
export const agentTextLimits = {
  /** One line the `quick_script` description lists for the namespace. */
  namespaceSummary: 200,
  /** Each of the (at most three) rules the description repeats. */
  rule: 300,
  /** The doc comment that starts a method signature, which `sdk.describe` and `sdk.search` print. */
  methodDescription: 300,
  /** The "when to read" line of a doc topic. */
  docTopicWhenToRead: 160,
  /** A doc topic's file, in characters. */
  docTopicChars: 24_000,
  /** A direct tool's description, which is sent with every request. */
  toolDescription: 800,
  /** An error message (and its fix) shown to the agent. */
  errorMessage: 600,
} as const;

/** Text of the doc comment that opens a signature (`/** … *\/ name(): T`), or "". */
function leadingDoc(signature: string): string {
  const match = /^\s*\/\*\*([\s\S]*?)\*\//.exec(signature);
  return (match?.[1] ?? "").replace(/\s*\n\s*\*?\s*/g, " ").trim();
}

/**
 * What in the manifest's agent-facing text is over its limit, as messages for diagnostics.
 * `readDoc` reads a doc topic file (already checked to exist).
 */
export function agentTextProblems(
  manifest: InstalledExtensionManifest,
  readDoc: (file: string) => string,
): string[] {
  const problems: string[] = [];
  const check = (what: string, text: string, limit: number) => {
    if (text.length > limit)
      problems.push(
        `${what} is ${text.length} characters; the limit for installed extensions is ${limit}. Shorten it and keep detail in a doc topic.`,
      );
  };
  for (const namespace of manifest.namespaces) {
    const at = `Namespace '${namespace.id}'`;
    check(
      `${at}: summary`,
      namespace.summary,
      agentTextLimits.namespaceSummary,
    );
    for (const [index, rule] of (namespace.rules ?? []).entries())
      check(`${at}: rule ${index + 1}`, rule, agentTextLimits.rule);
    for (const [path, method] of Object.entries(namespace.methods))
      check(
        `${at}: the description of method '${path}'`,
        leadingDoc(method.signature),
        agentTextLimits.methodDescription,
      );
    for (const topic of namespace.docs ?? []) {
      check(
        `${at}: whenToRead of doc topic '${topic.id}'`,
        topic.whenToRead,
        agentTextLimits.docTopicWhenToRead,
      );
      try {
        check(
          `${at}: doc topic '${topic.id}'`,
          readDoc(topic.file),
          agentTextLimits.docTopicChars,
        );
      } catch {
        // An unreadable topic is reported by its own check.
      }
    }
  }
  for (const tool of manifest.tools ?? [])
    check(
      `Tool '${tool.name}': description`,
      tool.description,
      agentTextLimits.toolDescription,
    );
  return problems;
}

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
