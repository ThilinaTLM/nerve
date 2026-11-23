import type { InstalledExtensionManifest } from "./installed-manifest.js";

/*
 * Every limit on what an extension author writes or a frame sends, in one place: the manifest
 * schema, the SDK build, the host and the built-in extensions' tests read these numbers, and doc
 * comments refer to them by name instead of repeating them.
 */

/**
 * Size limits on the text extensions put in front of a model (built-ins included) (docs/agent-facing.md:
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

/** Sizes of the files an extension ships, in bytes; the SDK build and the host read the same numbers. */
export const extensionFileLimits = {
  /** `dist/manifest.json`. */
  manifestBytes: 1024 * 1024,
  /** `dist/backend.js` and `dist/credentials.js`. */
  bundleBytes: 8 * 1024 * 1024,
  /** One doc topic file. */
  docBytes: 256 * 1024,
  /** An `.svg` icon. */
  iconBytes: 16 * 1024,
  /** One theme file. */
  themeBytes: 16 * 1024,
  /** All built files of one UI frame. */
  frameBytes: 32 * 1024 * 1024,
} as const;

/** Limits of the `ui` section; the SDK build and the host enforce the same numbers. */
export const extensionUiLimits = {
  /** Contributions per kind. */
  maxPerKind: 16,
  maxLabelLength: 64,
  maxExtensionsPerPreview: 32,
  maxExtensionLength: 32,
} as const;

/** Limits both sides enforce; a larger message is dropped (requests get a `too_large` error). */
export const bridgeLimits = {
  /** Serialized size of any message, in bytes. */
  maxMessageBytes: 8 * 1024 * 1024,
  /** Most bytes one `file.read` returns; the frame asks for more with a new offset. */
  maxReadChunkBytes: 1024 * 1024,
  /** Chunk size when `length` is not given. */
  defaultReadChunkBytes: 256 * 1024,
  /** Most bytes of content one `file.write` carries (decoded; base64 must fit the message limit). */
  maxWriteBytes: 5 * 1024 * 1024,
  /** Serialized size of the JSON `tabState`. */
  maxTabStateBytes: 64 * 1024,
  /** Serialized size of `call` args. */
  maxCallArgsBytes: 1024 * 1024,
  maxRequestIdLength: 64,
  maxMenuItems: 32,
  maxTextLength: 20_000,
  maxLabelLength: 200,
  /** Characters of the prompt of one `conversations.start`. */
  maxConversationPromptLength: 100_000,
  maxPageParamsBytes: 4 * 1024,
  /** Bytes of text one `clipboard.writeText` carries (UTF-8). */
  maxClipboardTextBytes: 1024 * 1024,
  /** Decoded bytes of one `clipboard.writeImage`. */
  maxClipboardImageBytes: 5 * 1024 * 1024,
  /** Characters of an store key. */
  maxStoreKeyLength: 128,
  /** Serialized size of one store value. */
  maxStoreValueBytes: 4 * 1024 * 1024,
  /** Serialized size of all values of one extension in one project. */
  maxStoreBytesPerProject: 64 * 1024 * 1024,
  /** Keys of one extension in one project. */
  maxStoreKeys: 1000,
  /** `frameError` reports the host forwards per frame load. */
  maxFrameErrorsPerLoad: 20,
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
        `${what} is ${text.length} characters; the limit is ${limit}. Shorten it and keep detail in a doc topic.`,
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
