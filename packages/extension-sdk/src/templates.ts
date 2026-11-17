import type { ExtensionKind } from "./init.js";

/** The files of a new extension project, by relative path. */
export type Template = Record<string, string>;

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

const common = (id: string, sdkVersion: string): Template => ({
  "package.json": `${JSON.stringify(
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
  )}\n`,
  "tsconfig.json": `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM"],
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        isolatedModules: true,
        resolveJsonModule: true,
        types: [],
      },
      include: ["src", "test"],
    },
    null,
    2,
  )}\n`,
  ".gitignore": "node_modules/\n",
});

function integration(id: string): Template {
  const ns = namespaceName(id);
  const tool = `${id.replace(/-/g, "_")}_get`;
  const name = title(id);
  return {
    "src/extension.ts": `import {
  defineExtension,
  defineNamespace,
  ExtensionError,
  method,
} from "@nervekit/extension-sdk";

/** Reads JSON from the configured server. */
export const get = method({
  risk: "external_read",
  signature:
    "/** GET a path on the configured server and return the parsed JSON (or text). */ get(path: string): Promise<unknown>",
  // A script passes the path; a direct tool bound to this method passes its arguments object.
  parse: (args) => {
    const first = args[0];
    const path =
      typeof first === "string" ? first : (first as { path?: unknown } | undefined)?.path;
    if (typeof path !== "string" || !path.startsWith("/"))
      throw new ExtensionError("BAD_REQUEST", "get needs a path that starts with '/'.", {
        fix: 'Pass a path such as "/items".',
      });
    return { path };
  },
  authorize: ({ path }) => [{ targets: [\`${id}:\${path}\`], summary: \`GET \${path}\` }],
  run: async (_session, { path }, ctx) => {
    const server = String(ctx.settings.get("server") ?? "").replace(/\\/+$/, "");
    const response = await ctx.http.request({ url: \`\${server}\${path}\` });
    if (!response.ok)
      throw new ExtensionError("SERVER_ERROR", \`The server answered \${response.status}.\`, {
        fix: "Check the server setting and the path.",
      });
    return response.body;
  },
});

export default defineExtension({
  id: "${id}",
  apiVersion: 1,
  name: "${name}",
  description: "Reads data from a server the user configures.",
  icon: "globe",
  enabledByDefault: false,
  settings: {
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
  },
  permissions: { network: ["{settings.server}"] },
  namespaces: [
    defineNamespace({
      id: "${ns}",
      label: "${name}",
      summary: "${name}: get(path) reads JSON from the configured server.",
      types: "",
      methods: { get },
    }),
  ],
  tools: [
    {
      name: "${tool}",
      description: "Read JSON from the configured ${name} server.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Path starting with '/'." } },
        required: ["path"],
        additionalProperties: false,
      },
      method: "${ns}.get",
    },
  ],
});
`,
    "test/extension.test.ts": `import { createFakeContext, describe, expect, it } from "@nervekit/extension-sdk/testing";
import extension, { get } from "../src/extension";
import fixture from "../fixtures/items.json";

describe("${id}", () => {
  it("declares its id", () => {
    expect(extension.id).toBe("${id}");
  });

  it("reads JSON from the configured server", async () => {
    const { ctx, record } = createFakeContext({
      settings: { server: "https://api.test/" },
      http: () => ({ status: 200, ok: true, headers: {}, url: "", body: fixture }),
    });
    const input = get.parse(["/items"]);
    expect(await get.run(undefined, input, ctx)).toEqual(fixture);
    expect(record.requests[0]?.url).toBe("https://api.test/items");
  });

  it("rejects a path without a leading slash", () => {
    expect(() => get.parse(["items"])).toThrow("starts with '/'");
  });
});
`,
    "fixtures/items.json": `${JSON.stringify(
      [
        { id: 1, name: "first" },
        { id: 2, name: "second" },
      ],
      null,
      2,
    )}\n`,
  };
}

const svelteTypes = `declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component<any>;
  export default component;
}
`;

/** The definition and tests of the kinds that only contribute UI: no backend namespaces. */
function uiExtension(
  id: string,
  options: { icon: string; description: string; ui: string; note?: string },
): Template {
  return {
    "src/extension.ts": `import { defineExtension } from "@nervekit/extension-sdk";

export default defineExtension({
  id: "${id}",
  apiVersion: 1,
  name: "${title(id)}",
  description: "${options.description}",
  icon: "${options.icon}",
  enabledByDefault: true,
  settings: { version: 1, fields: {} },
  namespaces: [],
${options.note ? `${options.note}\n` : ""}  ui: ${options.ui},
});
`,
    "src/svelte.d.ts": svelteTypes,
  };
}

const csvModule = `/** Parses CSV or TSV text into rows of cells; quoted cells may hold the delimiter and line breaks. */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\\n" || char === "\\r") {
      if (char === "\\r" && text[index + 1] === "\\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
`;

function previewKind(id: string): Template {
  return {
    ...uiExtension(id, {
      icon: "table",
      description: "Shows CSV and TSV files as a table.",
      note: `  // A preview that edits its own file: set \`edit: "custom"\` below, then use host.file.write(...)
  // and the \`mode\` store in the component. Without it, Nerve's source editor edits the file.`,
      ui: `{
    previews: [
      {
        id: "table",
        label: "Table",
        match: { extensions: [".csv", ".tsv"] },
        entry: "src/ui/table.svelte",
      },
    ],
  }`,
    }),
    "src/ui/csv.ts": csvModule,
    "src/ui/table.svelte": `<script lang="ts">
  import { Badge, host } from "@nervekit/extension-sdk/ui";
  import { parseCsv } from "./csv";

  let rows = $state<string[][]>([]);
  let error = $state<string | undefined>();
  let loading = $state(true);

  async function load() {
    try {
      const info = await host.file.info();
      rows = parseCsv(await host.file.text(), info.extension === ".tsv" ? "\\t" : ",");
      error = undefined;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  // Load now, and again whenever the file changes on disk.
  $effect(() => {
    void load();
    return host.onFileChange(() => void load());
  });

  const header = $derived(rows[0] ?? []);
  const body = $derived(rows.slice(1));
</script>

{#if error}
  <p class="p-4 text-ui text-destructive">{error}</p>
{:else if loading}
  <p class="p-4 text-ui text-muted-foreground">Loading…</p>
{:else}
  <div class="flex h-screen flex-col bg-background text-foreground">
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <Badge variant="neutral">{body.length} rows</Badge>
      <Badge variant="neutral">{header.length} columns</Badge>
    </div>
    <div class="min-h-0 flex-1 overflow-auto">
      <table class="w-full border-collapse text-ui">
        <thead class="sticky top-0 bg-card">
          <tr>
            {#each header as cell}
              <th class="border-b border-border px-3 py-1.5 text-left font-medium">{cell}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each body as row}
            <tr class="hover:bg-hover">
              {#each row as cell}
                <td class="border-b border-border-subtle px-3 py-1.5">{cell}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/if}
`,
    "test/csv.test.ts": `import { describe, expect, it } from "@nervekit/extension-sdk/testing";
import { parseCsv } from "../src/ui/csv";

describe("parseCsv", () => {
  it("splits rows and cells", () => {
    expect(parseCsv("a,b\\n1,2\\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps delimiters and quotes inside quoted cells", () => {
    expect(parseCsv('x,"a,""b"""\\n')).toEqual([["x", 'a,"b"']]);
  });
});
`,
    "test/table.test.ts": `import { afterEach, createFakeBridge, describe, expect, it } from "@nervekit/extension-sdk/testing";
import { host } from "@nervekit/extension-sdk/ui";
import { parseCsv } from "../src/ui/csv";

// The fake bridge answers like Nerve: the component's \`host\` reads the file you give it.
describe("table preview", () => {
  let bridge: ReturnType<typeof createFakeBridge> | undefined;
  afterEach(() => bridge?.close());

  it("reads the previewed file through the bridge", async () => {
    bridge = createFakeBridge({
      file: { path: "data/people.csv", content: "name,age\\nAda,36\\n" },
    });
    await host.ready;
    const info = await host.file.info();
    expect(info.extension).toBe(".csv");
    expect(parseCsv(await host.file.text())).toEqual([["name", "age"], ["Ada", "36"]]);
  });
});
`,
  };
}

function pageKind(id: string): Template {
  return {
    ...uiExtension(id, {
      icon: "layout-dashboard",
      description: "A page that shows the project and opens files.",
      ui: `{
    pages: [
      {
        id: "overview",
        label: "${title(id)}",
        icon: "layout-dashboard",
        entry: "src/ui/overview.svelte",
      },
    ],
  }`,
    }),
    "src/ui/overview.svelte": `<script lang="ts">
  import { Button, host } from "@nervekit/extension-sdk/ui";

  let project = $state<{ name: string; directory: string } | undefined>();
  let path = $state("README.md");

  $effect(() => {
    void host.project.info().then((info) => (project = info));
  });

  async function remember() {
    await host.viewState.set({ path });
  }
</script>

<main class="flex h-screen flex-col gap-3 bg-background p-4 text-foreground">
  <h1 class="text-title font-medium">{project?.name ?? "…"}</h1>
  <p class="text-ui text-muted-foreground">{project?.directory}</p>
  <div class="flex items-center gap-2">
    <input
      class="h-control rounded-md border border-input bg-input-background px-2 text-ui"
      bind:value={path}
      onchange={remember}
    />
    <Button onclick={() => host.openFile(path)}>Open file</Button>
    <Button variant="outline" onclick={() => host.ui.notify("Hello from ${id}", "success")}>
      Notify
    </Button>
  </div>
</main>
`,
    "test/page.test.ts": `import { afterEach, createFakeBridge, describe, expect, it } from "@nervekit/extension-sdk/testing";
import { host } from "@nervekit/extension-sdk/ui";

describe("page", () => {
  let bridge: ReturnType<typeof createFakeBridge> | undefined;
  afterEach(() => bridge?.close());

  it("opens files and notifies through the host", async () => {
    bridge = createFakeBridge({ kind: "page", project: { name: "demo" } });
    await host.ready;
    expect((await host.project.info()).name).toBe("demo");
    await host.openFile("README.md");
    await host.ui.notify("done", "success");
    expect(bridge.opened.files).toEqual(["README.md"]);
    expect(bridge.notifications).toEqual([{ message: "done", level: "success" }]);
  });
});
`,
  };
}

function panelKind(id: string): Template {
  return {
    ...uiExtension(id, {
      icon: "list-checks",
      description: "A side panel with a checklist that keeps its state.",
      ui: `{
    panels: [
      {
        id: "checklist",
        label: "${title(id)}",
        icon: "list-checks",
        entry: "src/ui/checklist.svelte",
      },
    ],
  }`,
    }),
    "src/ui/checklist.svelte": `<script lang="ts">
  import { Button, Checkbox, host } from "@nervekit/extension-sdk/ui";

  type Item = { text: string; done: boolean };
  let items = $state<Item[]>([]);
  let draft = $state("");

  // The host keeps the panel's view state; read it back when the panel opens.
  $effect(() => {
    void host.viewState.get().then((state) => {
      if (state && typeof state === "object" && "items" in state) items = state.items as Item[];
    });
  });

  function save() {
    void host.viewState.set({ items });
  }

  function add() {
    if (!draft.trim()) return;
    items.push({ text: draft.trim(), done: false });
    draft = "";
    save();
  }
</script>

<div class="flex h-screen flex-col gap-2 bg-panel p-3 text-foreground">
  <form class="flex gap-2" onsubmit={(event) => { event.preventDefault(); add(); }}>
    <input
      class="h-control min-w-0 flex-1 rounded-md border border-input bg-input-background px-2 text-ui"
      placeholder="Add an item"
      bind:value={draft}
    />
    <Button type="submit">Add</Button>
  </form>
  <ul class="min-h-0 flex-1 overflow-auto">
    {#each items as item}
      <li class="flex items-center gap-2 py-1 text-ui">
        <Checkbox bind:checked={item.done} onCheckedChange={save} />
        <span class={item.done ? "text-muted-foreground line-through" : ""}>{item.text}</span>
      </li>
    {/each}
  </ul>
</div>
`,
    "test/panel.test.ts": `import { afterEach, createFakeBridge, describe, expect, it } from "@nervekit/extension-sdk/testing";
import { host } from "@nervekit/extension-sdk/ui";

describe("panel", () => {
  let bridge: ReturnType<typeof createFakeBridge> | undefined;
  afterEach(() => bridge?.close());

  it("keeps its state with the host", async () => {
    bridge = createFakeBridge({ kind: "panel" });
    await host.ready;
    await host.viewState.set({ items: [{ text: "a", done: false }] });
    expect(await host.viewState.get()).toEqual({ items: [{ text: "a", done: false }] });
  });

  it("cannot read files: panels are not previews", async () => {
    bridge = createFakeBridge({ kind: "panel" });
    await host.ready;
    await expect(host.file.info()).rejects.toMatchObject({ code: "not_allowed" });
  });
});
`,
  };
}

// Warm paper tones; every theme must meet the same readability rules as the built-in ones
// (nerve-ext build checks them).
const themeTokens = {
  background: "oklch(0.965 0.012 92)",
  foreground: "oklch(0.3438 0.0269 95.7)",
  primary: "oklch(0.57 0.1375 39)",
  success: "oklch(0.47 0.17 149.2)",
  warning: "oklch(0.5 0.16 70.1)",
  info: "oklch(0.49 0.158 254.1)",
  destructive: "oklch(0.5 0.19 27)",
  "destructive-solid": "oklch(0.55 0.21 27.5)",
  "syntax-variable": "oklch(0.4 0.03 96)",
  "syntax-punctuation": "oklch(0.51 0.02 96)",
  "syntax-comment": "oklch(0.51 0.032 110)",
  "syntax-keyword": "oklch(0.49 0.15 25)",
  "syntax-string": "oklch(0.47 0.11 150)",
  "syntax-number": "oklch(0.48 0.14 310)",
  "syntax-function": "oklch(0.48 0.14 265)",
  "syntax-type": "oklch(0.47 0.09 210)",
  "syntax-property": "oklch(0.49 0.13 78)",
};

function themeKind(id: string): Template {
  return {
    ...uiExtension(id, {
      icon: "palette",
      description: "A colour theme.",
      ui: `{
    themes: [
      {
        id: "${id}",
        label: "${title(id)}",
        file: "themes/${id}.json",
      },
    ],
  }`,
    }),
    [`themes/${id}.json`]: `${JSON.stringify(
      { id, label: title(id), kind: "light", tokens: themeTokens },
      null,
      2,
    )}\n`,
    "test/theme.test.ts": `import { describe, expect, it } from "@nervekit/extension-sdk/testing";
import theme from "../themes/${id}.json";

describe("theme ${id}", () => {
  it("sets all 17 tokens", () => {
    expect(Object.keys(theme.tokens)).toHaveLength(17);
  });
});
`,
  };
}

export function projectTemplate(
  id: string,
  kind: ExtensionKind,
  sdkVersion: string,
): Template {
  return {
    ...common(id, sdkVersion),
    ...{
      integration,
      preview: previewKind,
      page: pageKind,
      panel: panelKind,
      theme: themeKind,
    }[kind](id),
  };
}
