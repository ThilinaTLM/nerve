<script lang="ts">
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { CodeMirrorEditor, CodeMirrorViewer } from "$lib/presentation/code";
import CodeMirrorFindPanel from "$lib/presentation/code/CodeMirrorFindPanel.svelte";
import { FilePane } from "$lib/presentation/files";
import type { FilePaneViewModel } from "$lib/presentation/files";
import { MermaidPane } from "$lib/presentation/mermaid";
import GitDiffPane from "$lib/features/git/views/GitDiffPane.svelte";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";

const noop = () => {};

const tsSample = `import { createServer } from "node:http";

type Handler = (req: Request) => Promise<Response>;

/** Retries a handler with exponential backoff. */
export function withRetry(handler: Handler, attempts = 3): Handler {
  return async (req) => {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await handler(req.clone());
      } catch (error) {
        lastError = error;
        await new Promise((r) => setTimeout(r, 2 ** i * 100));
      }
    }
    throw lastError;
  };
}

const PORT = Number(process.env.PORT ?? 3000);
createServer().listen(PORT, () => console.log(\`listening on \${PORT}\`));
`;

const jsonSample = `{
  "name": "@nervekit/workbench-app",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "svelte": "^5.0.0"
  }
}
`;

const markdownSample = `# Workbench conventions

Compact desktop IDE built on **Electron** and *Svelte 5*. See \`AGENTS.md\` for the full rules.

## Checklist

- Use theme-token Tailwind utilities
- Keep controls on the shared heights
- Monospace only for code, logs and paths

| Surface | Used for |
| --- | --- |
| \`well\` | Recessed output |
| \`panel\` | Shell chrome |

\`\`\`ts
const heights = ["default", "sm"] as const;
\`\`\`

> Prefer clean, simple architecture over compatibility layers.
`;

const flowchart = `flowchart TD
  U[User prompt] --> A{Needs tools?}
  A -- yes --> T[Run tool call]
  T --> R[Collect result]
  R --> A
  A -- no --> S[Stream answer]
  S --> D((Done))`;

const diffOriginal = `export const greeting = "hello";
export const target = "world";

export function greet(): string {
  return \`\${greeting}, \${target}\`;
}
`;
const diffModified = `export const greeting = "hello";
export const target = "Nerve";

export function greet(name = target): string {
  return \`\${greeting}, \${name}!\`;
}

export const shout = () => greet().toUpperCase();
`;

function fileView(
  name: string,
  text: string,
  overrides: Partial<FilePaneViewModel> = {},
  editable = false,
): FilePaneViewModel {
  return {
    path: `/home/dev/nerve/${name}`,
    loading: false,
    content: {
      path: `/home/dev/nerve/${name}`,
      relativePath: name,
      name: name.split("/").pop() ?? name,
      size: text.length,
      type: "text",
      text,
      editable,
    },
    ...overrides,
  };
}

const tsView = fileView("src/lib/retry.ts", tsSample);
const jsonView = fileView("package.json", jsonSample, { wrapLines: false });
const markdownView = fileView("docs/CONVENTIONS.md", markdownSample);
const diffView = {
  path: "src/greeting.ts",
  repo: "/home/dev/nerve",
  area: "staged" as const,
  loading: false,
  refreshing: false,
  data: {
    binary: false as const,
    path: "src/greeting.ts",
    area: "staged" as const,
    original: diffOriginal,
    modified: diffModified,
  },
};

let draft = $state(jsonSample);
let jsonValue = $state(jsonSample);
let wrap = $state(false);
let findQuery = $state("handler");
let caseSensitive = $state(false);
let wholeWord = $state(false);
let regexp = $state(false);
</script>

<div class="flex flex-col gap-10">
  <GalleryGroup
    title="In context"
    description="A center tab as the app shows it (about 900×520): code and rendered Markdown through FilePane, plus the staged diff."
  >
    <GallerySpecimen
      title="Code file (read-only)"
      description="FilePane → CodeMirrorViewer with the read-only footer note."
      source="presentation/files/FilePane"
      usage="1 file · editor"
      layout="bare"
    >
      <div
        class="h-[520px] w-[900px] max-w-full overflow-hidden rounded-md border"
      >
        <FilePane
          view={tsView}
          onOpenFile={noop}
          onToggleWrap={noop}
          onToggleSelectionMatches={noop}
        />
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Rendered Markdown"
      description="Markdown files open rendered by default."
      source="presentation/files/FilePane"
      usage="1 file · editor"
      layout="bare"
    >
      <div
        class="h-[520px] w-[900px] max-w-full overflow-hidden rounded-md border"
      >
        <FilePane view={markdownView} onOpenFile={noop} />
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Staged diff (inline)"
      description="GitDiffPane → CodeMirrorGitDiff, unified view."
      source="features/git/views/GitDiffPane"
      usage="1 file · editor"
      layout="bare"
    >
      <div
        class="h-[520px] w-[900px] max-w-full overflow-hidden rounded-md border"
      >
        <GitDiffPane view={diffView} onRefresh={noop} />
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="File pane states"
    description="Variations on the same pane that actually occur."
  >
    <GallerySpecimen
      title="JSON, editable with unsaved-change markers"
      description="Editable files mark changed lines against the saved text; Ctrl/⌘+S saves."
      source="presentation/files/FilePane"
      usage="1 file · editor"
      layout="bare"
    >
      <div
        class="h-[260px] w-[900px] max-w-full overflow-hidden rounded-md border"
      >
        <FilePane
          view={fileView(
            "package.json",
            jsonSample,
            { draft, dirty: draft !== jsonSample },
            true,
          )}
          onChange={(next) => (draft = next)}
          onSave={noop}
        />
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Truncated and read-only"
      description="Large files show a preview and a footer note instead of editing."
      source="presentation/files/FilePane"
      usage="1 file · editor"
      layout="bare"
    >
      <div
        class="h-[200px] w-[900px] max-w-full overflow-hidden rounded-md border"
      >
        <FilePane
          view={{
            ...jsonView,
            content: jsonView.content
              ? { ...jsonView.content, truncated: true }
              : undefined,
          }}
        />
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Loading and error"
      source="presentation/files/FilePane"
      usage="1 file · editor"
      layout="bare"
    >
      <div class="grid w-[900px] max-w-full gap-4 md:grid-cols-2">
        <div class="h-[200px] overflow-hidden rounded-md border">
          <FilePane view={{ path: "src/big.ts", loading: true }} />
        </div>
        <div class="h-[200px] overflow-hidden rounded-md border">
          <FilePane
            view={{
              path: "src/missing.ts",
              loading: false,
              error: "ENOENT: no such file or directory",
            }}
          />
        </div>
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Code editors"
    description="The CodeMirror pieces behind FilePane and dialogs."
  >
    <GallerySpecimen
      title="CodeMirrorViewer"
      description="Syntax highlighting, line numbers, folding, find (Ctrl/⌘+F), context menu (right-click)."
      source="presentation/code/CodeMirrorViewer"
      usage="1 file · editor"
      layout="stack"
    >
      <div class="flex gap-2">
        <Button variant="outline" active={wrap} onclick={() => (wrap = !wrap)}
          >Wrap: {wrap ? "on" : "off"}</Button
        >
      </div>
      <div
        class="h-[260px] w-[900px] max-w-full overflow-hidden rounded-md border"
      >
        <CodeMirrorViewer
          text={tsSample}
          language="typescript"
          {wrap}
          onToggleWrap={() => (wrap = !wrap)}
          ariaLabel="TypeScript sample"
        />
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="CodeMirrorEditor"
      description="Compact JSON editor used in the model-definition dialog; shown enabled and disabled."
      source="presentation/code/CodeMirrorEditor"
      usage="1 file · dialogs"
      layout="stack"
    >
      <div class="grid w-[900px] max-w-full gap-4 md:grid-cols-2">
        <div class="h-48 overflow-hidden rounded-md border">
          <CodeMirrorEditor
            value={jsonValue}
            onChange={(next) => (jsonValue = next)}
            ariaLabel="JSON editor"
          />
        </div>
        <div class="h-48 overflow-hidden rounded-md border">
          <CodeMirrorEditor
            value={jsonSample}
            disabled
            ariaLabel="Disabled JSON editor"
          />
        </div>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="CodeMirrorFindPanel"
      description="The find bar (normally opened with Ctrl/⌘+F inside a viewer): query, case, whole word, regexp, match status."
      source="presentation/code/CodeMirrorFindPanel"
      usage="2 files · editor, git"
      layout="bare"
    >
      <div
        class="relative h-24 w-[900px] max-w-full overflow-hidden rounded-md border bg-background"
      >
        <CodeMirrorFindPanel
          query={findQuery}
          {caseSensitive}
          {wholeWord}
          {regexp}
          status="3 matches"
          valid
          onQueryChange={(v) => (findQuery = v)}
          onCaseSensitiveChange={(v) => (caseSensitive = v)}
          onWholeWordChange={(v) => (wholeWord = v)}
          onRegexpChange={(v) => (regexp = v)}
          onPrevious={noop}
          onNext={noop}
          onClose={noop}
        />
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Diagrams"
    description="Mermaid files open rendered in their own tab."
  >
    <GallerySpecimen
      title="MermaidPane — ready"
      description="Pan (drag), zoom (toolbar, Ctrl+wheel) and fit."
      source="presentation/mermaid/MermaidPane"
      usage="2 files · editor"
      layout="bare"
    >
      <div
        class="h-[420px] w-[900px] max-w-full overflow-hidden rounded-md border"
      >
        <MermaidPane source={flowchart} />
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="MermaidPane — error"
      source="presentation/mermaid/MermaidPane"
      usage="2 files · editor"
      layout="bare"
    >
      <div
        class="h-[200px] w-[900px] max-w-full overflow-hidden rounded-md border"
      >
        <MermaidPane error="The file could not be read: permission denied." />
      </div>
    </GallerySpecimen>
  </GalleryGroup>
</div>
