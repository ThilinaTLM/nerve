<script lang="ts">
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import FileIcon from "@lucide/svelte/icons/file";
import FolderIcon from "@lucide/svelte/icons/folder";
import GitBranchIcon from "@lucide/svelte/icons/git-branch";
import InfoIcon from "@lucide/svelte/icons/info";
import SearchIcon from "@lucide/svelte/icons/search";
import SettingsIcon from "@lucide/svelte/icons/settings";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";

// "uses" = approximate class occurrences in the desktop app (excl. gallery, mobile).
const sizes = [
  { name: "text-xs", cls: "text-xs", uses: 462, role: "Chrome, rows, meta" },
  { name: "text-sm", cls: "text-sm", uses: 170, role: "Body, row titles" },
  { name: "text-base", cls: "text-base", uses: 11, role: "Page titles" },
  { name: "text-lg", cls: "text-lg", uses: 7, role: "Rare headings" },
] as const;

const weights = [
  { name: "font-normal", cls: "font-normal", uses: 20 },
  { name: "font-medium", cls: "font-medium", uses: 117 },
  { name: "font-semibold", cls: "font-semibold", uses: 51 },
] as const;

const icons = [
  { name: "size-3", cls: "size-3", uses: 68 },
  { name: "size-3.5", cls: "size-3.5", uses: 204 },
  { name: "size-4", cls: "size-4", uses: 85 },
  { name: "size-5", cls: "size-5", uses: 12 },
] as const;

const codeSample =
  "const run = await daemon.runs.start(input);\nif (!run.ok) throw new Error(run.error);";
const sample = "The quick brown fox jumps over the lazy dog";
const longText =
  "refactor-conversation-timeline-projection-with-a-really-long-descriptive-title-that-never-fits.ts";
const longPath =
  "/home/tlm/Projects/nerve/packages/workbench-app/src/lib/presentation/transcript/notice/mappers/task-completed.ts";
</script>

<div class="flex flex-col gap-10">
  <GalleryGroup
    title="Type scale"
    description="text-xs is 13px/18px and text-sm is 15px/22px in this theme. Sans (Outfit) for UI; monospace (Iosevka) only for code, logs, and paths."
  >
    <GallerySpecimen title="Sizes" usage="all areas" layout="stack">
      {#each sizes as size (size.name)}
        <div class="flex items-baseline gap-4">
          <span class="w-28 shrink-0 text-xs text-muted-foreground"
            >{size.name} · {size.uses}</span
          >
          <span class="text-foreground {size.cls}">{sample}</span>
          <span class="hidden text-xs text-muted-foreground md:inline"
            >{size.role}</span
          >
        </div>
      {/each}
    </GallerySpecimen>

    <GallerySpecimen
      title="Weights at text-sm"
      usage="all areas"
      layout="stack"
    >
      {#each weights as weight (weight.name)}
        <div class="flex items-baseline gap-4">
          <span class="w-36 shrink-0 text-xs text-muted-foreground"
            >{weight.name} · {weight.uses}</span
          >
          <span class="text-sm text-foreground {weight.cls}">{sample}</span>
        </div>
      {/each}
    </GallerySpecimen>

    <GallerySpecimen
      title="Families & colour roles"
      layout="stack"
      surface="card"
    >
      <p class="font-sans text-sm text-foreground">
        font-sans · foreground — primary content
      </p>
      <p class="font-sans text-sm text-muted-foreground">
        font-sans · muted-foreground — secondary content (≈530 uses)
      </p>
      <p class="font-mono text-xs text-foreground">
        font-mono (≈117 uses) — code, logs, paths
      </p>
      <div class="flex flex-wrap gap-4 text-sm">
        <span class="text-primary">primary</span>
        <span class="text-info">info</span>
        <span class="text-success">success</span>
        <span class="text-warning">warning</span>
        <span class="text-destructive">destructive</span>
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Settings type ladder"
    description="Three sizes only (base / sm / xs); weight and colour carry the rest. Sentence case, no uppercase eyebrows."
  >
    <GallerySpecimen title="Spec" usage="settings" layout="stack">
      {#each [["Page title", "text-base font-semibold text-foreground"], ["Page subtitle", "text-sm text-muted-foreground"], ["Section heading", "text-sm font-semibold text-foreground"], ["Group heading", "text-sm font-semibold text-muted-foreground"], ["Row title", "text-sm text-foreground"], ["Supporting text", "text-xs text-muted-foreground"]] as [role, spec] (role)}
        <div class="flex items-baseline gap-4 text-xs">
          <span class="w-32 shrink-0 text-foreground">{role}</span>
          <code class="font-mono text-muted-foreground">{spec}</code>
        </div>
      {/each}
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Monospace & truncation"
    description="Mono is reserved for code, paths and logs. Rows truncate to one line; paths may break-all."
  >
    <GallerySpecimen title="Code, paths, logs" layout="stack" surface="well">
      <code class="font-mono text-xs text-foreground"
        >pnpm exec tsx --test packages/protocol/src/session.test.ts</code
      >
      <pre class="font-mono text-xs text-foreground">{codeSample}</pre>
    </GallerySpecimen>

    <GallerySpecimen
      title="Truncate & break-all"
      layout="stack"
      class="max-w-sm"
    >
      <div class="flex min-w-0 items-center gap-2">
        <FileIcon class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="min-w-0 truncate text-sm text-foreground">{longText}</span>
        <span class="shrink-0 text-xs text-muted-foreground">12 KB</span>
      </div>
      <p class="truncate font-mono text-xs text-muted-foreground">{longPath}</p>
      <p class="font-mono text-xs break-all text-muted-foreground">
        {longPath}
      </p>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Icon sizes"
    description="lucide icons: size-3.5 is the dense-chrome default, size-3 in badges, size-4 for larger controls, size-5 for headers."
  >
    <GallerySpecimen title="Sizes" usage="all areas" layout="stack">
      {#each icons as icon (icon.name)}
        <div class="flex items-center gap-4">
          <span class="w-28 shrink-0 text-xs text-muted-foreground"
            >{icon.name} · {icon.uses}</span
          >
          <SettingsIcon class="text-foreground {icon.cls}" />
          <SearchIcon class="text-muted-foreground {icon.cls}" />
          <GitBranchIcon class="text-success {icon.cls}" />
          <FolderIcon class="text-warning {icon.cls}" />
          <InfoIcon class="text-info {icon.cls}" />
        </div>
      {/each}
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="In context"
    description="A 280px side-panel row set and a transcript-width paragraph, using the ladder above."
  >
    <GallerySpecimen
      title="Panel rows (280px)"
      layout="bare"
      surface="panel"
      class="p-0"
    >
      <div class="w-[280px] max-w-full">
        <div class="flex h-8 items-center gap-1.5 px-3 text-xs">
          <span class="font-semibold text-foreground">Files</span>
          <span class="text-muted-foreground">33</span>
        </div>
        <div class="flex flex-col gap-0.5 px-1.5 pb-2 text-sm">
          <div class="flex min-w-0 items-center gap-2 rounded-md px-2 py-1">
            <FolderIcon class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="min-w-0 truncate text-foreground">packages</span>
          </div>
          <div
            class="flex min-w-0 items-center gap-2 rounded-md bg-selected px-2 py-1"
          >
            <FileIcon class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="min-w-0 truncate text-foreground">{longText}</span>
            <Badge variant="warning" class="ml-auto">M</Badge>
          </div>
          <div class="flex min-w-0 items-center gap-2 rounded-md px-2 py-1">
            <GitBranchIcon class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="min-w-0 truncate text-foreground">fix/retain-plan</span
            >
            <span class="ml-auto shrink-0 text-xs text-muted-foreground"
              >56m</span
            >
          </div>
        </div>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Transcript column (720px)"
      layout="bare"
      class="p-4"
    >
      <div class="flex w-[720px] max-w-full flex-col gap-2">
        <p class="text-sm text-foreground">
          I'll start by reading
          <code class="rounded-sm bg-muted px-1 font-mono text-xs"
            >session.ts</code
          >, then trace how the store is initialised. The fix should be small.
        </p>
        <div class="flex items-center gap-2 text-xs">
          <span class="font-medium text-foreground">read</span>
          <span class="truncate font-mono text-muted-foreground"
            >{longPath}</span
          >
        </div>
        <span class="text-xs text-muted-foreground">lines 257–262</span>
      </div>
    </GallerySpecimen>
  </GalleryGroup>
</div>
