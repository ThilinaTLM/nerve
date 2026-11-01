import { dirname, relative, resolve } from "node:path";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const componentsRoot = fileURLToPath(
  new URL("../../../../../ui-kit/src/lib/components/", import.meta.url),
);

/** Directories intentionally absent from the lab, each with its reason. */
const EXEMPT: Record<string, string> = {};

function directories(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function sectionSources(): string {
  return readdirSync(`${here}sections`)
    .filter((name) => /\.(svelte|ts)$/.test(name))
    .map((name) => readFileSync(`${here}sections/${name}`, "utf8"))
    .join("\n");
}

for (const group of ["ui", "composites"] as const) {
  test(`every ui-kit ${group} component is shown in a design-lab section`, () => {
    const sources = sectionSources();
    const missing = directories(`${componentsRoot}${group}`).filter(
      (name) =>
        !(`${group}/${name}` in EXEMPT) &&
        !new RegExp(`components/${group}/${name}(?:["'/])`).test(sources),
    );
    assert.deepEqual(
      missing,
      [],
      `Add a specimen (Primitives or Composites page) or an EXEMPT entry for: ${missing.join(", ")}`,
    );
  });
}

test("exemptions still refer to existing component directories", () => {
  for (const key of Object.keys(EXEMPT)) {
    const [group, name] = key.split("/");
    assert.ok(
      directories(`${componentsRoot}${group}`).includes(name ?? ""),
      `${key} no longer exists; remove its exemption`,
    );
  }
});

const libRoot = fileURLToPath(new URL("../../", import.meta.url));
const presentationRoot = `${libRoot}presentation/`;
const packagesRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

/** Internal parts are exercised by their parent specimens, not useful standalone. */
const PRESENTATION_EXEMPT: Record<string, string> = {
  // needs composer editor context; covered by AgentComposer
  "composer/ComposerEditor.svelte": "AgentComposer",
  // needs capabilities editor context; covered by ComposerCapabilitiesPopover
  "composer/ComposerCapabilityPanel.svelte": "ComposerCapabilitiesPopover",
  // needs permission editor context; covered by AgentComposer
  "composer/ComposerPermissionPanel.svelte": "AgentComposer",
  // needs profile editor context; covered by AgentComposer
  "composer/ComposerProfilePanel.svelte": "AgentComposer",
  // Tool body sections share their containing tool card's interaction and layout.
  "tools/tool-call/AskUserToolView.svelte": "ToolCallCard (ask_user)",
  "tools/tool-call/AskUserActions.svelte": "ToolCallCard (ask_user)",
  "tools/tool-call/AskUserQuestion.svelte": "ToolCallCard (ask_user)",
  "tools/tool-call/AtlassianOutcomeRow.svelte": "ToolCallCard (Atlassian)",
  "tools/tool-call/AtlassianResourceRow.svelte": "ToolCallCard (Atlassian)",
  "tools/tool-call/AtlassianResultSurface.svelte": "ToolCallCard (Atlassian)",
  "tools/tool-call/ConfluencePageRow.svelte": "ToolCallCard (Confluence)",
  "tools/tool-call/ImageFrame.svelte": "ToolCallCard (image)",
  "tools/tool-call/ToolImage.svelte": "ToolCallCard (image)",
  "tools/tool-call/ToolArgumentBody.svelte": "ToolCallCard",
  "tools/tool-call/ToolSections.svelte": "ToolCallCard",
  // Rendered by the real ConversationWelcome and empty TranscriptList specimens.
  "conversations/ConversationSignal.svelte":
    "ConversationWelcome, TranscriptList",
};

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      if (
        ["node_modules", "design-lab", "dist", ".git", "__tests__"].includes(
          entry.name,
        )
      )
        return [];
      const path = `${root}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(?:svelte|ts|js)$/.test(entry.name) &&
        !/\.(?:test|spec)\./.test(entry.name)
        ? [path]
        : [];
    })
    .sort();
}

// Resolve direct imports and named barrel exports, including aliases. Counting
// importing files (not references or re-exports) keeps the 2-consumer rule stable.
function componentImports(file: string, source: string): Set<string> {
  const result = new Set<string>();
  for (const match of source.matchAll(
    /\bimport\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g,
  )) {
    const [, bindings, specifier] = match;
    const target = specifier.startsWith("$lib/")
      ? resolve(libRoot, specifier.slice(5))
      : specifier.startsWith(".")
        ? resolve(dirname(file), specifier)
        : undefined;
    if (!target?.startsWith(presentationRoot)) continue;
    if (target.endsWith(".svelte") && existsSync(target)) {
      result.add(target);
      continue;
    }
    const barrel = `${target}/index.ts`;
    if (!existsSync(barrel)) continue;
    for (const exported of readFileSync(barrel, "utf8").matchAll(
      /export\s*\{\s*default\s+as\s+(\w+)\s*\}\s*from\s*["']([^"']+\.svelte)["']/g,
    )) {
      const named = bindings.match(/\{([\s\S]*?)\}/)?.[1] ?? "";
      if (
        new RegExp(
          `(?:^|,)\\s*${exported[1]}(?:\\s+as\\s+\\w+)?\\s*(?:,|$)`,
        ).test(named) ||
        /\*\s+as\s+/.test(bindings)
      ) {
        result.add(resolve(target, exported[2]));
      }
    }
  }
  return result;
}

test("shared presentation components with 2+ product consumers have specimens", () => {
  const consumers = new Map<string, Set<string>>();
  for (const file of sourceFiles(packagesRoot)) {
    for (const component of componentImports(
      file,
      readFileSync(file, "utf8"),
    )) {
      if (component === file) continue;
      const files = consumers.get(component) ?? new Set<string>();
      files.add(file);
      consumers.set(component, files);
    }
  }
  const shown = new Set<string>();
  for (const name of readdirSync(`${here}sections`).sort()) {
    if (!/\.(?:svelte|ts)$/.test(name)) continue;
    const file = `${here}sections/${name}`;
    for (const component of componentImports(file, readFileSync(file, "utf8")))
      shown.add(component);
  }
  const missing = [...consumers]
    .filter(
      ([file, uses]) =>
        uses.size >= 2 &&
        !shown.has(file) &&
        !(relative(presentationRoot, file) in PRESENTATION_EXEMPT),
    )
    .map(([file]) => relative(presentationRoot, file))
    .sort();
  assert.deepEqual(
    missing,
    [],
    `Add specimens or documented parent exemptions for: ${missing.join(", ")}`,
  );
  for (const [file, parent] of Object.entries(PRESENTATION_EXEMPT)) {
    assert.ok(
      existsSync(`${presentationRoot}${file}`),
      `${file} no longer exists; remove its exemption`,
    );
    assert.ok(parent.trim(), `${file} needs a parent-specimen explanation`);
  }
});

/* Top-level feature surfaces (dock panels and center views) must render the
 * real component in the lab, never a replica. */

test("dock panels and center views render the real component in the lab", () => {
  const surfaces = sourceFiles(`${libRoot}features`)
    .filter((file) => /\/views\/[^/]+(?:Panel|View)\.svelte$/.test(file))
    .concat(`${libRoot}app/discover/components/DiscoverView.svelte`);
  const sectionSource = readdirSync(`${here}sections`)
    .filter((name) => /\.(?:svelte|ts)$/.test(name))
    .map((name) => readFileSync(`${here}sections/${name}`, "utf8"))
    .join("\n");
  const missing = surfaces
    .map((file) => relative(libRoot, file))
    .filter((file) => {
      const name = file.split("/").pop()!.replace(".svelte", "");
      return !new RegExp(
        `import\\s+${name}\\s+from\\s+["'][^"']*${name}\\.svelte["']`,
      ).test(sectionSource);
    })
    .sort();
  assert.deepEqual(
    missing,
    [],
    `Render these real views in a Design Lab section: ${missing.join(", ")}`,
  );
});
