/**
 * The direct tools removed in favour of `quick_script` namespaces, each with
 * the SDK operations that replace it (docs/proposals/extensions/parity.md),
 * and the conversion of permission rules that name them. Plain-JSON shapes
 * only: this must not follow later changes to the evolving contracts. The
 * project permission overlay chain (`permission-overlay` v3) shares it so
 * home and project files convert identically.
 */
type Json = Record<string, unknown>;
export type Loss = (reason: string) => void;

/** What replaces a removed tool: typed operations, and a raw-request recipe where the SDK has no typed method for part of it. */
export type RemovedToolRoute = {
  operations: readonly string[];
  raw?: "jira" | "confluence";
};

const jira = (...paths: string[]) => paths.map((path) => `jira.${path}`);
const confluence = (...paths: string[]) =>
  paths.map((path) => `confluence.${path}`);

export const REMOVED_TOOL_OPERATIONS: Readonly<
  Record<string, RemovedToolRoute>
> = {
  jira_search_users: { operations: jira("users.search", "users.me") },
  jira_search_issues: { operations: jira("issues.search") },
  jira_get_issue: {
    operations: jira("issues.get", "attachments.list", "worklogs.list"),
  },
  jira_get_project: {
    operations: jira("projects.get", "projects.list", "fields.list"),
  },
  jira_search_boards: { operations: jira("projects.get"), raw: "jira" },
  jira_get_board: { operations: [], raw: "jira" },
  jira_get_sprint: { operations: jira("sprints.issues", "projects.get") },
  jira_download_attachment: { operations: jira("attachments.download") },
  jira_create_issue: { operations: jira("issues.create") },
  jira_update_issue: { operations: jira("issues.update", "issues.delete") },
  jira_transition_issue: { operations: jira("issues.transition") },
  jira_manage_comment: {
    operations: jira("comments.add", "comments.update", "comments.delete"),
  },
  jira_manage_worklog: {
    operations: jira("worklogs.add", "worklogs.update", "worklogs.delete"),
  },
  jira_manage_issue_link: { operations: jira("issues.link", "issues.unlink") },
  jira_manage_attachment: {
    operations: jira("attachments.upload", "attachments.delete"),
  },
  jira_manage_sprint: {
    operations: jira(
      "sprints.create",
      "sprints.update",
      "sprints.start",
      "sprints.close",
      "sprints.delete",
    ),
  },
  jira_manage_backlog: { operations: jira("issues.move", "issues.rank") },
  confluence_search_spaces: { operations: confluence("spaces.search") },
  confluence_search_pages: {
    operations: confluence("pages.search", "pages.get"),
  },
  confluence_get_page: {
    operations: confluence("pages.get", "comments.list", "attachments.list"),
  },
  confluence_download_page: { operations: confluence("pages.download") },
  confluence_create_page: { operations: confluence("pages.create") },
  confluence_update_page: {
    operations: confluence("pages.update", "pages.move"),
  },
  confluence_manage_comment: {
    operations: confluence(
      "comments.add",
      "comments.reply",
      "comments.update",
      "comments.delete",
      "comments.resolve",
    ),
  },
  confluence_manage_page: {
    operations: confluence("pages.delete", "pages.restore"),
  },
  confluence_manage_label: {
    operations: confluence("labels.add", "labels.remove"),
  },
  confluence_manage_restriction: { operations: [], raw: "confluence" },
  confluence_manage_attachment: {
    operations: confluence("attachments.upload", "attachments.delete"),
    raw: "confluence",
  },
  kroki_export: { operations: ["diagram.render"] },
  generate_image: { operations: ["imagegen.generate"] },
};

/** Tool groups of removed tools and the namespaces that took them over (`jira` and `confluence` keep their names). */
const GROUP_RENAMES: Readonly<Record<string, string>> = {
  imageGeneration: "imagegen",
  diagramExport: "diagram",
};

export const isRemovedTool = (name: string): boolean =>
  Object.hasOwn(REMOVED_TOOL_OPERATIONS, name);

const isRecord = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Filters whose meaning depends on the removed tool's own schema or risk category. */
const TOOL_SCHEMA_FILTERS = [
  "arguments",
  "primaryArgument",
  "primaryTarget",
  "targets",
  "baseRisks",
] as const;

const operationMatcher = (operations: readonly string[]): Json =>
  operations.length === 1
    ? { operator: "glob", value: operations[0] }
    : { operator: "in", value: [...operations] };

/**
 * The operations that carry a rule's decision over to `quick_script`, or why
 * it cannot be carried over. An allow never widens to raw requests; a deny or
 * prompt does, because the removed tool's raw-request recipes would otherwise
 * escape it.
 */
function operationsFor(
  tools: readonly string[],
  decision: unknown,
): { operations: string[] } | { problem: string } {
  const operations = new Set<string>();
  for (const tool of tools) {
    const route = REMOVED_TOOL_OPERATIONS[tool];
    for (const operation of route.operations) operations.add(operation);
    if (route.raw && decision !== "allow")
      operations.add(`${route.raw}.request`);
  }
  return operations.size
    ? { operations: [...operations] }
    : {
        problem:
          "has no typed operation to allow (only raw requests replace it)",
      };
}

/** A priority no other rule of the same enforcement uses, as close to `wanted` as possible. */
function freePriority(rules: readonly Json[], rule: Json): number {
  const taken = new Set(
    rules.map(
      (other) => `${String(other.enforcement)}:${String(other.priority)}`,
    ),
  );
  const wanted = typeof rule.priority === "number" ? rule.priority : 0;
  for (let distance = 1; distance <= 2_000; distance++)
    for (const candidate of [wanted - distance, wanted + distance])
      if (
        candidate >= -1_000 &&
        candidate <= 1_000 &&
        !taken.has(`${String(rule.enforcement)}:${candidate}`)
      )
        return candidate;
  throw new Error("No free rule priority");
}

/**
 * Rewrites rules that name removed tools, in one `rules` array (an overlay or
 * a rule set), per the table in permissions.md:
 *
 * - `toolNames` of removed tools become `quick_script` with a `primaryArgument`
 *   matching the replacing operations; names of tools that remain stay in
 *   the original rule and the conversion becomes a sibling rule.
 * - `toolGroups` of removed groups move to the namespace that replaced them.
 * - A rule that depends on the removed tool's schema (argument, target or
 *   risk-category filters) or has nothing to allow is disabled and reported,
 *   never dropped.
 */
export function convertRemovedToolRules(
  rules: readonly unknown[],
  loss: Loss,
): { rules: unknown[]; changed: boolean } {
  const result: Json[] = rules.map((rule) =>
    isRecord(rule) ? structuredClone(rule) : (rule as Json),
  );
  const additions: Json[] = [];
  let changed = false;
  for (const rule of result) {
    if (!isRecord(rule) || !isRecord(rule.when)) continue;
    const when = rule.when;
    if (Array.isArray(when.toolGroups)) {
      const groups = (when.toolGroups as unknown[]).map((group) =>
        typeof group === "string" && GROUP_RENAMES[group]
          ? GROUP_RENAMES[group]
          : group,
      );
      const unique = [...new Set(groups)];
      if (JSON.stringify(unique) !== JSON.stringify(when.toolGroups)) {
        when.toolGroups = unique;
        changed = true;
      }
    }
    const names = Array.isArray(when.toolNames)
      ? (when.toolNames as unknown[]).filter(
          (name): name is string => typeof name === "string",
        )
      : [];
    const removed = names.filter(isRemovedTool);
    if (removed.length === 0) continue;
    changed = true;
    const id = String(rule.id);
    const problem = TOOL_SCHEMA_FILTERS.some((key) => when[key] !== undefined)
      ? "matches on the removed tool's arguments, targets or risk category"
      : (() => {
          const found = operationsFor(removed, rule.decision);
          return "problem" in found ? found.problem : undefined;
        })();
    if (problem) {
      rule.enabled = false;
      loss(
        `Permission rule "${id}" names ${removed.join(", ")} and ${problem}; it was disabled. Recreate it for quick_script operations`,
      );
      continue;
    }
    const found = operationsFor(removed, rule.decision) as {
      operations: string[];
    };
    const converted: Json = {
      ...structuredClone(rule),
      when: {
        ...omit(when, "toolNames"),
        toolNames: ["quick_script"],
        primaryArgument: operationMatcher(found.operations),
      },
    };
    const kept = names.filter((name) => !isRemovedTool(name));
    if (kept.length === 0) {
      rule.when = converted.when;
    } else {
      when.toolNames = kept;
      converted.id = `${id}-quick-script`.slice(0, 128);
      converted.priority = freePriority([...result, ...additions], rule);
      additions.push(converted);
    }
  }
  return { rules: [...result, ...additions], changed };
}

const omit = (value: Json, key: string): Json =>
  Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

/** A permission overlay document (`overlays[].rules`), as the home, conversation and project files store it. */
export function convertPermissionOverlayDocument(
  document: unknown,
  loss: Loss,
): { document: unknown; changed: boolean } {
  if (!isRecord(document) || !Array.isArray(document.overlays))
    return { document, changed: false };
  let changed = false;
  const overlays = document.overlays.map((overlay: unknown) => {
    if (!isRecord(overlay) || !Array.isArray(overlay.rules)) return overlay;
    const converted = convertRemovedToolRules(overlay.rules, loss);
    changed ||= converted.changed;
    return { ...overlay, rules: converted.rules };
  });
  return { document: changed ? { ...document, overlays } : document, changed };
}

/** A custom rule set file (`rules`). */
export function convertRuleSetDocument(
  document: unknown,
  loss: Loss,
): { document: unknown; changed: boolean } {
  if (!isRecord(document) || !Array.isArray(document.rules))
    return { document, changed: false };
  const converted = convertRemovedToolRules(document.rules, loss);
  return {
    document: converted.changed
      ? { ...document, rules: converted.rules }
      : document,
    changed: converted.changed,
  };
}

/**
 * An allow/deny exception (`{ tool, effect, rule }`) naming a removed tool as
 * `quick_script` with an operation glob. Exceptions whose operations are
 * several globs, or that have nothing to allow, are reported by the caller
 * (`null`) and become one exception per operation otherwise.
 */
export function convertRemovedToolException(exception: {
  id: string;
  tool: string;
  effect: string;
  rule: string;
}): { id: string; tool: string; effect: string; rule: string }[] | null {
  const route = REMOVED_TOOL_OPERATIONS[exception.tool];
  if (!route) return [exception];
  const found = operationsFor([exception.tool], exception.effect);
  if ("problem" in found) return null;
  // A whole-tool exception (`*`) is the only form the removed tools accepted.
  const namespaces = new Set(found.operations.map((op) => op.split(".")[0]));
  if (namespaces.size === 1 && found.operations.length > 1) {
    const [namespace] = namespaces;
    // `jira.comments.*` when every operation of one group is covered; else one per operation.
    const groups = new Set(found.operations.map((op) => op.split(".")[1]));
    if (groups.size === 1)
      return [
        {
          ...exception,
          tool: "quick_script",
          rule: `${namespace}.${[...groups][0]}.*`,
        },
      ];
  }
  return found.operations.map((operation, index) => ({
    ...exception,
    id: index === 0 ? exception.id : `${exception.id}_${index}`.slice(0, 128),
    tool: "quick_script",
    rule: operation,
  }));
}

/** Whether an enabled rule still names a removed tool (a disabled, reported one may). */
export function hasEnabledRemovedToolRule(document: unknown): boolean {
  if (!isRecord(document)) return false;
  const lists = Array.isArray(document.overlays)
    ? document.overlays.flatMap((overlay: unknown) =>
        isRecord(overlay) && Array.isArray(overlay.rules) ? overlay.rules : [],
      )
    : Array.isArray(document.rules)
      ? document.rules
      : [];
  return lists.some(
    (rule: unknown) =>
      isRecord(rule) &&
      rule.enabled !== false &&
      isRecord(rule.when) &&
      Array.isArray(rule.when.toolNames) &&
      rule.when.toolNames.some(
        (name: unknown) => typeof name === "string" && isRemovedTool(name),
      ),
  );
}
