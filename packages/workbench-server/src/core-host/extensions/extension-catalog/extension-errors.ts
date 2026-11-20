import type { ExtensionAgentError } from "@nervekit/tools/extension-host";
import { truncateAgentText } from "./agent-text-limits.js";

/** Most failures kept per extension; the oldest drop first. */
export const maxErrorsPerExtension = 20;
/** Most extensions tracked at once; the least recently failed drop first. */
export const maxTrackedExtensions = 64;
const maxMessageLength = 400;

/**
 * Bounded in-memory record of the failures the host saw of installed extensions, keyed by
 * extension id and cleared when the extension is reloaded: backend failures while running their
 * code (every hook, including calls from their frames) and the errors their frames report
 * (uncaught errors, unhandled rejections, CSP violations; operation `frame:<kind>/<id>`). Frame
 * console output is not recorded: the bridge has no message for it.
 */
export class ExtensionErrorLog {
  readonly #errors = new Map<string, ExtensionAgentError[]>();

  record(id: string, operation: string, error: unknown): void {
    const entry: ExtensionAgentError = {
      at: new Date().toISOString(),
      operation,
      code:
        (error as { code?: unknown } | null)?.code !== undefined &&
        typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : error instanceof Error
            ? error.name
            : "Error",
      message: truncateAgentText(
        error instanceof Error ? error.message : String(error),
        maxMessageLength,
      ),
    };
    const list = this.#errors.get(id) ?? [];
    list.push(entry);
    if (list.length > maxErrorsPerExtension)
      list.splice(0, list.length - maxErrorsPerExtension);
    // Re-insert so the Map order is least recently failed first.
    this.#errors.delete(id);
    this.#errors.set(id, list);
    while (this.#errors.size > maxTrackedExtensions)
      this.#errors.delete(this.#errors.keys().next().value!);
  }

  recent(id: string): ExtensionAgentError[] {
    return [...(this.#errors.get(id) ?? [])];
  }

  /** `id` omitted: forget everything. */
  clear(id?: string): void {
    if (id === undefined) this.#errors.clear();
    else this.#errors.delete(id);
  }
}
