import { defineFileRule } from "./policy.ts";

/**
 * Goal 1 of docs/proposals/extension-platform: outside its own folder
 * (`packages/extensions/src/<id>/`), an extension is named only by the built-in
 * registry list (`packages/extensions/src/index.ts`) and by old migration steps and
 * their frozen schemas. Production source elsewhere may not name one in code;
 * comments and tests (which use them as fixtures) are exempt.
 */
const EXTENSION_NAME =
  /atlassian|jira|confluence|tavily|kroki|imagegen(?!erat)/i;

/** Reviewed leftovers. Each needs a reason; the list only shrinks. */
export const EXTENSION_NAMING_EXCEPTIONS: ReadonlyMap<string, string> = new Map(
  [
    ["packages/extensions/src/index.ts", "the built-in registry list"],
    [
      "packages/tools/src/policy/rule-sets/planning.json",
      "the planning rule set is product policy: a quick_script operation's tool group is its namespace, and planning allows network reads in the Atlassian namespaces only (not diagram or image generation). Extensions do not declare read-only research namespaces",
    ],
    [
      "packages/conversation-core/src/conversations/conversation-title.ts",
      "titles a conversation from a pasted ticket URL; `/browse/KEY-1` and `/jira/browse/…` are URL shapes of any tracker",
    ],
  ],
);

/** Pending removal: generic replacements are owned by the app/contracts streams of the extension platform (README decision 3). */
export const EXTENSION_NAMING_PENDING: ReadonlyMap<string, string> = new Map([
  [
    "packages/contracts/src/domains/permissions/permissions.ts",
    "error message example (`jira.issues.*`)",
  ],
  [
    "packages/extension-api/src/types.ts",
    "`ImagegenBackend` type name (rename to `ImageBackend`)",
  ],
  [
    "packages/workbench-server/src/domains/image-generation/image-generation.provider.ts",
    "uses `ImagegenBackend`",
  ],
  [
    "packages/workbench-server/src/domains/image-generation/image-generation.service.ts",
    "uses `ImagegenBackend`",
  ],
  [
    "packages/workbench-server/src/domains/image-generation/providers/openai-codex-image-generation.provider.ts",
    "uses `ImagegenBackend`",
  ],
  [
    "packages/workbench-server/src/core-host/project-permission-migrations.ts",
    "migration message for the removed direct tools",
  ],
  [
    "packages/workbench-app/src/lib/app/design-lab/sections/SettingsSection.svelte",
    "design-lab fixtures",
  ],
  [
    "packages/workbench-app/src/lib/app/design-lab/sections/ToolCardsSection.svelte",
    "design-lab fixtures",
  ],
  [
    "packages/workbench-app/src/lib/app/design-lab/sections/tool-card-view-fixtures.ts",
    "design-lab fixtures",
  ],
  [
    "packages/workbench-app/src/lib/features/settings/registry/settings-page-data.ts",
    "redirects of retired Integrations settings sections",
  ],
  [
    "packages/workbench-app/src/lib/features/settings/views/pages/extensions/extensions-view.ts",
    "`HELPER_NAMESPACES` (derive from the namespace's `helper` flag)",
  ],
  [
    "packages/workbench-app/src/lib/features/settings/views/pages/tools/tool-settings.ts",
    "description text naming Jira and Confluence",
  ],
  [
    "packages/workbench-app/src/lib/presentation/tools/lifecycle/core-specs.ts",
    "description text naming Jira and Confluence",
  ],
]);

const SCANNED = /^packages\/[^/]+\/src\/.*\.(?:ts|svelte|json|js|mjs)$/;
const OUT_OF_SCOPE =
  /\.test\.ts$|\.d\.ts$|\/test\/|\/migrations\/steps\/|\/frozen\/|^packages\/website\/|^packages\/extensions\/src\/(?:atlassian|web|diagram|imagegen)\//;

export function extensionNamingViolations(
  file: string,
  text: string,
): string[] {
  if (!SCANNED.test(file) || OUT_OF_SCOPE.test(file)) return [];
  if (
    EXTENSION_NAMING_EXCEPTIONS.has(file) ||
    EXTENSION_NAMING_PENDING.has(file)
  )
    return [];
  const violations: string[] = [];
  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (/^(?:\/\/|\/?\*)/.test(trimmed)) return;
    const name = line.match(EXTENSION_NAME)?.[0];
    if (name)
      violations.push(
        `line ${index + 1} names the extension '${name}' outside its folder; derive it from the registry instead`,
      );
  });
  return violations;
}

export const extensionNamingRule = defineFileRule(
  "extension-naming",
  "outside its folder an extension is named only by the built-in registry list and old migration steps",
  (file, read) =>
    SCANNED.test(file) && !OUT_OF_SCOPE.test(file)
      ? extensionNamingViolations(file, read())
      : [],
);
