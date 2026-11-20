import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionKind } from "./init.js";

/** The files of a new extension project, by relative path. */
export type Template = Record<string, string>;

/**
 * The template files, one folder per part (`base`, `ui`, and one per kind). From `src/` and from
 * the bundled `dist/` alike, the folder is one level up.
 */
const templatesDir = fileURLToPath(new URL("../templates", import.meta.url));

/** `my-service` becomes `myService`: namespace ids are global names in the script sandbox. */
export function namespaceName(id: string): string {
  const camel = id.replace(/-([a-z0-9])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
  return camel.slice(0, 32);
}

function title(id: string): string {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** npm drops `.gitignore` from published packages, so template files are stored without the dot. */
const renamed: Record<string, string> = { gitignore: ".gitignore" };

/** The files of one template part, with `__ID__`, `__TITLE__` and `__NAMESPACE__` filled in. */
function part(name: string, values: Record<string, string>): Template {
  const fill = (text: string) =>
    text.replace(/__([A-Z]+)__/g, (match, key: string) => values[key] ?? match);
  const root = join(templatesDir, name);
  const files: Template = {};
  for (const entry of readdirSync(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const path = relative(root, join(entry.parentPath, entry.name))
      .split("\\")
      .join("/");
    files[fill(renamed[path] ?? path)] = fill(
      readFileSync(join(root, path), "utf8"),
    );
  }
  return files;
}

function packageJson(id: string, sdkVersion: string): string {
  return `${JSON.stringify(
    {
      name: id,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        build: "nerve-ext build",
        check: "nerve-ext check",
        test: "nerve-ext test",
        dev: "nerve-ext dev",
      },
      dependencies: { "@nervekit/extension-sdk": sdkVersion },
    },
    null,
    2,
  )}\n`;
}

/** The extension's own icon must be one of the few lucide names an extension may use (or an SVG). */
const about: Record<ExtensionKind, { icon: string; description: string }> = {
  integration: {
    icon: "globe",
    description: "Reads data from a server the user configures.",
  },
  preview: { icon: "eye", description: "Shows CSV and TSV files as a table." },
  page: {
    icon: "layers",
    description: "A page that shows the project and opens files.",
  },
  panel: {
    icon: "blocks",
    description: "A side panel with a checklist that keeps its state.",
  },
  theme: { icon: "blocks", description: "A light color theme." },
};

/** `src/extension.ts`: only the definition, wiring the parts the chosen kinds added. */
function extensionSource(id: string, kinds: readonly ExtensionKind[]): string {
  const name = title(id);
  const has = (kind: ExtensionKind) => kinds.includes(kind);
  const integration = has("integration");
  const ui: string[] = [];
  if (has("preview"))
    ui.push(`    previews: [
      {
        id: "table",
        label: "Table",
        match: { extensions: [".csv", ".tsv"] },
        entry: "src/previews/table/Table.svelte",
        // To edit the file in the preview itself, set \`edit: "custom"\` and use
        // host.file.write(...) with the \`mode\` store. Without it, Nerve's source editor edits the file.
      },
    ],`);
  if (has("page"))
    ui.push(`    pages: [
      {
        id: "overview",
        label: "${name}",
        icon: "layout-dashboard",
        entry: "src/pages/overview/Overview.svelte",
      },
    ],`);
  if (has("panel"))
    ui.push(`    panels: [
      {
        id: "checklist",
        label: "${name}",
        icon: "list-checks",
        entry: "src/panels/checklist/Checklist.svelte",
      },
    ],`);
  if (has("theme"))
    ui.push(`    themes: [
      { id: "${id}", label: "${name}", file: "src/themes/${id}.json" },
    ],`);
  const settings = integration
    ? `{
    version: 1,
    fields: {
      server: {
        type: "string",
        label: "Server",
        description: "Base URL of the server; requests are sent to it.",
        format: "url",
        default: "https://example.com",
      },
    },
  }`
    : "{ version: 1, fields: {} }";
  const lines = [
    `import { defineExtension } from "@nervekit/extension-sdk";`,
    ...(integration
      ? [`import { namespace } from "./backend/namespace";`]
      : []),
    "",
    "export default defineExtension({",
    `  id: "${id}",`,
    `  name: "${name}",`,
    `  description: "${kinds.map((kind) => about[kind].description).join(" ")}",`,
    `  icon: "${about[kinds[0]!].icon}",`,
    // Anything that reaches the network stays off until the user turns it on.
    `  enabledByDefault: ${!integration},`,
    `  settings: ${settings},`,
    ...(integration
      ? [
          `  permissions: { network: ["{settings.server}"] },`,
          "  namespaces: [namespace],",
          `  tools: [
    {
      name: "${id.replace(/-/g, "_")}_get",
      description: "Read JSON from the configured ${name} server.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path starting with '/'." },
        },
        required: ["path"],
        additionalProperties: false,
      },
      method: "${namespaceName(id)}.get",
    },
  ],`,
        ]
      : ["  namespaces: [],"]),
    ...(ui.length > 0 ? ["  ui: {", ...ui, "  },"] : []),
    "});",
    "",
  ];
  return lines.join("\n");
}

/** The project for one or more kinds; their parts combine into one `src/extension.ts`. */
export function projectTemplate(
  id: string,
  kinds: readonly ExtensionKind[],
  sdkVersion: string,
): Template {
  const values = { ID: id, TITLE: title(id), NAMESPACE: namespaceName(id) };
  const usesSvelte = kinds.some((kind) =>
    ["preview", "page", "panel"].includes(kind),
  );
  return Object.assign(
    {
      "package.json": packageJson(id, sdkVersion),
      "src/extension.ts": extensionSource(id, kinds),
    },
    part("base", values),
    usesSvelte ? part("ui", values) : {},
    ...kinds.map((kind) => part(kind, values)),
  );
}
