import { createHash } from "node:crypto";

const READ_TOOLS = ["read", "grep", "find", "ls"] as const;
const WRITE_TOOLS = ["edit", "write"] as const;

export function migrateLegacyPermissionValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const converted = convertLegacyException(entry);
      return converted ?? [migrateLegacyPermissionValue(entry)];
    });
  }
  if (!isRecord(value)) {
    return value === "always_global" ? "always_user" : value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = migrateLegacyPermissionValue(entry);
  }
  if (result.version === 1 && Array.isArray(result.exceptions)) {
    result.version = 2;
  }
  return result;
}

function convertLegacyException(
  value: unknown,
): Record<string, unknown>[] | undefined {
  if (!isRecord(value) || !isRecord(value.selector)) return undefined;
  const effect =
    value.effect === "allow"
      ? "allow"
      : value.effect === "deny"
        ? "deny"
        : undefined;
  if (!effect) return undefined;
  const selector = value.selector;
  const kind = selector.kind;
  const drafts: Array<{ tool: string; effect: string; rule: string }> = [];
  if (kind === "tool" && typeof selector.toolName === "string") {
    drafts.push({ tool: selector.toolName, effect, rule: "*" });
  } else if (kind === "command_prefix" && Array.isArray(selector.tokens)) {
    const command = selector.tokens
      .filter((token): token is string => typeof token === "string")
      .join(" ");
    if (command)
      drafts.push({
        tool: "bash",
        effect,
        rule: `${escapeGlobLiteral(command)}{, *}`,
      });
  } else if (kind === "web_host" && typeof selector.pattern === "string") {
    drafts.push({
      tool: "web_fetch",
      effect,
      rule: `*://${selector.pattern.toLowerCase()}/**`,
    });
  } else if (kind === "path_glob" && typeof selector.pattern === "string") {
    const tools =
      selector.access === "read"
        ? READ_TOOLS
        : selector.access === "write"
          ? WRITE_TOOLS
          : [...READ_TOOLS, ...WRITE_TOOLS];
    for (const tool of tools) {
      drafts.push({ tool, effect, rule: selector.pattern });
    }
  } else {
    return undefined;
  }
  return drafts.map((draft) => ({ ...draft, id: exceptionId(draft) }));
}

function exceptionId(value: object): string {
  return `exception_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

function escapeGlobLiteral(value: string): string {
  return value.replace(/[?*[{]/g, (character) => `[${character}]`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
