/*
 * Origin patterns of an extension's manifest: `permissions.network` entries and
 * account kind `origins`. A pattern is a URL origin where `*` stands for one
 * host label (`https://*.atlassian.net`), or a template filled from user
 * configuration: `{account.<field>}` (a field of the selected account),
 * `{settings.<key>}` (a setting of the extension) and, in an account kind's
 * `origins`, `{<field>}` of that account.
 */

/** Values the templates read. */
export type TemplateValues = {
  /** Fields of one selected account. */
  account?: Record<string, unknown>;
  settings?: Record<string, unknown>;
};

const TEMPLATE = /\{(?:(account|settings)\.)?([A-Za-z][A-Za-z0-9]*)\}/g;

/** Fills the templates; undefined when a value is not a non-empty string. */
export function fillTemplate(
  pattern: string,
  values: TemplateValues,
): string | undefined {
  let missing = false;
  const filled = pattern.replace(
    TEMPLATE,
    (_, scope: string | undefined, name: string) => {
      const value = (scope === "settings" ? values.settings : values.account)?.[
        name
      ];
      if (typeof value !== "string" || value.length === 0) {
        missing = true;
        return "";
      }
      return value;
    },
  );
  return missing ? undefined : filled;
}

const hasTemplate = (pattern: string): boolean => pattern.includes("{");

/** Whether `url` is within `pattern` (a filled origin pattern; any path of the pattern is ignored). */
export function originMatches(url: URL, pattern: string): boolean {
  if (!pattern.includes("*")) {
    try {
      return new URL(pattern).origin === url.origin;
    } catch {
      return false;
    }
  }
  const parsed = /^(https?:)\/\/([^/]+)/.exec(pattern);
  if (!parsed) return false;
  const [, protocol, host] = parsed;
  if (protocol !== url.protocol) return false;
  const expression = host
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^.]+");
  return new RegExp(`^${expression}$`, "i").test(url.host);
}

/**
 * The patterns a request may match: plain ones as they are, templates once per
 * selected account. `fromUser` marks patterns the user supplied through an
 * account field or a setting (their own server, which may be on a private network).
 */
export function expandPatterns(
  patterns: readonly string[],
  input: {
    accounts: readonly Record<string, unknown>[];
    settings: Record<string, unknown>;
  },
): { pattern: string; fromUser: boolean }[] {
  return patterns.flatMap(
    (pattern): { pattern: string; fromUser: boolean }[] => {
      if (!hasTemplate(pattern)) return [{ pattern, fromUser: false }];
      const sources = pattern.includes("{account.")
        ? input.accounts.map((account) => ({
            account,
            settings: input.settings,
          }))
        : [{ account: {}, settings: input.settings }];
      return sources.flatMap((values) => {
        const filled = fillTemplate(pattern, values);
        return filled ? [{ pattern: filled, fromUser: true }] : [];
      });
    },
  );
}
