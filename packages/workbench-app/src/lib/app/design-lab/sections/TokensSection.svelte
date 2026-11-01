<script lang="ts">
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import FileIcon from "@lucide/svelte/icons/file";
import FolderIcon from "@lucide/svelte/icons/folder";
import GitBranchIcon from "@lucide/svelte/icons/git-branch";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";

type Swatch = { name: string; bg: string; fg?: string; uses?: number };

// "uses" = approximate class occurrences in the desktop app (excl. gallery, mobile).
const swatches: Swatch[] = [
  { name: "background", bg: "bg-background", fg: "text-foreground", uses: 26 },
  { name: "card", bg: "bg-card", fg: "text-card-foreground", uses: 32 },
  {
    name: "popover",
    bg: "bg-popover",
    fg: "text-popover-foreground",
    uses: 14,
  },
  { name: "panel", bg: "bg-panel", fg: "text-foreground", uses: 7 },
  { name: "well", bg: "bg-well", fg: "text-foreground", uses: 21 },
  { name: "muted", bg: "bg-muted", fg: "text-muted-foreground", uses: 38 },
  { name: "accent", bg: "bg-accent", fg: "text-accent-foreground", uses: 28 },
  { name: "selected", bg: "bg-selected", fg: "text-foreground", uses: 26 },
  {
    name: "primary",
    bg: "bg-primary",
    fg: "text-primary-foreground",
    uses: 18,
  },
  {
    name: "destructive-solid",
    bg: "bg-destructive-solid",
    fg: "text-destructive-solid-foreground",
    uses: 5,
  },
  { name: "success", bg: "bg-success", fg: "text-success-foreground", uses: 5 },
  { name: "warning", bg: "bg-warning", fg: "text-warning-foreground", uses: 6 },
  { name: "info", bg: "bg-info", fg: "text-info-foreground", uses: 7 },
];

const ladder = [
  {
    name: "well",
    cls: "bg-well",
    role: "Recessed output: terminal, logs, code",
  },
  { name: "panel", cls: "bg-panel", role: "Dock panels and shell chrome" },
  { name: "background", cls: "bg-background", role: "Workspace" },
  { name: "card", cls: "bg-card", role: "Raised content" },
  { name: "popover", cls: "bg-popover", role: "Floating layers" },
] as const;

const tones = [
  {
    name: "neutral",
    text: "text-muted-foreground",
    tint: "bg-muted-foreground/10",
    border: "border-muted-foreground/30",
  },
  {
    name: "accent",
    text: "text-primary",
    tint: "bg-primary/10",
    border: "border-primary/30",
  },
  {
    name: "info",
    text: "text-info",
    tint: "bg-info/10",
    border: "border-info/30",
  },
  {
    name: "success",
    text: "text-success",
    tint: "bg-success/10",
    border: "border-success/30",
  },
  {
    name: "warning",
    text: "text-warning",
    tint: "bg-warning/10",
    border: "border-warning/30",
  },
  {
    name: "destructive",
    text: "text-destructive",
    tint: "bg-destructive/10",
    border: "border-destructive/30",
  },
] as const;

const radii = [
  { name: "rounded-sm", cls: "rounded-sm", uses: 80 },
  { name: "rounded-md", cls: "rounded-md", uses: 118 },
  { name: "rounded-lg", cls: "rounded-lg", uses: 15 },
  { name: "rounded-xl", cls: "rounded-xl", uses: 2 },
  { name: "rounded-full", cls: "rounded-full", uses: 58 },
] as const;

const shadows = [
  { name: "shadow-xs", cls: "shadow-xs", uses: 12 },
  { name: "shadow-sm", cls: "shadow-sm", uses: 12 },
  { name: "shadow-md", cls: "shadow-md", uses: 4 },
  { name: "shadow-lg", cls: "shadow-lg", uses: 4 },
  { name: "shadow-xl", cls: "shadow-xl", uses: 2 },
  { name: "shadow-overlay", cls: "shadow-overlay", uses: 6 },
] as const;
</script>

<div class="flex flex-col gap-10">
  <GalleryGroup
    title="Surfaces"
    description="well < panel < background < card < popover. Counts are approximate class uses in the desktop app."
  >
    <GallerySpecimen title="Surface ladder" layout="bare">
      <div
        class="grid grid-cols-2 gap-0 overflow-hidden rounded-md border md:grid-cols-5"
      >
        {#each ladder as step (step.name)}
          <div class="flex min-h-28 flex-col gap-1 p-3 {step.cls}">
            <span class="text-ui font-semibold text-foreground"
              >{step.name}</span
            >
            <span class="text-ui text-foreground">Foreground</span>
            <span class="text-ui text-muted-foreground">Muted supporting</span>
            <span class="mt-auto text-ui text-muted-foreground"
              >{step.role}</span
            >
          </div>
        {/each}
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Color tokens in use"
      usage="theme tokens · all areas"
      source="styles/theme.css"
      layout="bare"
    >
      <div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
        {#each swatches as swatch (swatch.name)}
          <div class="flex flex-col gap-1">
            <div
              class="flex h-12 items-end rounded-md border p-2 text-ui {swatch.bg} {swatch.fg ??
                ''}"
            >
              Aa
            </div>
            <span class="text-ui text-foreground">{swatch.name}</span>
            {#if swatch.uses}
              <span class="text-ui text-muted-foreground"
                >in use: {swatch.uses}</span
              >
            {/if}
          </div>
        {/each}
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Status tones"
    description="Six tones: text, /10 tint and /30 border. destructive text appears ~110×, warning ~59×, success ~35×, info ~20×."
  >
    <GallerySpecimen title="Text · tint · tint + border" layout="bare">
      <div class="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
        {#each tones as tone (tone.name)}
          <div class="flex flex-col gap-2">
            <span class="text-ui font-medium {tone.text}">{tone.name}</span>
            <div class="rounded-md px-3 py-1.5 text-ui {tone.tint} {tone.text}">
              tint
            </div>
            <div
              class="rounded-md border px-3 py-1.5 text-ui {tone.border} {tone.tint} {tone.text}"
            >
              tint + border
            </div>
          </div>
        {/each}
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Tints on each surface"
      layout="stack"
      surface="well"
    >
      {#each ladder as step (step.name)}
        <div
          class="flex flex-wrap items-center gap-2 rounded-md border p-2 {step.cls}"
        >
          <span class="w-24 text-ui text-muted-foreground">{step.name}</span>
          {#each tones as tone (tone.name)}
            <span
              class="rounded-md border px-2 py-0.5 text-ui {tone.border} {tone.tint} {tone.text}"
            >
              {tone.name}
            </span>
          {/each}
        </div>
      {/each}
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Radius & elevation"
    description="Only the radii and shadows the app uses. rounded-md dominates; shadow-overlay is the floating-layer recipe."
  >
    <GallerySpecimen title="Radius" usage="all areas" layout="bare">
      <div class="flex flex-wrap gap-4">
        {#each radii as radius (radius.name)}
          <div class="flex flex-col items-center gap-1.5">
            <div class="size-14 border bg-card {radius.cls}"></div>
            <span class="text-ui text-muted-foreground">{radius.name}</span>
            <span class="text-ui text-muted-foreground"
              >in use: {radius.uses}</span
            >
          </div>
        {/each}
      </div>
    </GallerySpecimen>

    <GallerySpecimen title="Shadow" usage="controls, overlays" layout="bare">
      <div class="flex flex-wrap gap-6 p-2">
        {#each shadows as shadow (shadow.name)}
          <div class="flex flex-col items-center gap-1.5">
            <div
              class="size-16 rounded-md border bg-popover {shadow.cls}"
            ></div>
            <span class="text-ui text-muted-foreground">{shadow.name}</span>
            <span class="text-ui text-muted-foreground"
              >in use: {shadow.uses}</span
            >
          </div>
        {/each}
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="In context"
    description="The surfaces as the workbench stacks them at desktop width: panel chrome, background workspace, card, popover, well output."
  >
    <GallerySpecimen title="Workbench layers" layout="bare" class="p-0">
      <div class="flex h-80 w-[720px] max-w-full overflow-hidden rounded-lg">
        <div class="flex w-[220px] shrink-0 flex-col border-r bg-panel">
          <div class="flex h-8 items-center gap-2 border-b px-3 text-ui">
            <span class="font-medium text-foreground">Files</span>
            <span class="text-muted-foreground">33</span>
          </div>
          <div class="flex flex-col gap-0.5 p-1.5 text-ui">
            <div class="flex items-center gap-2 rounded-md px-2 py-1">
              <FolderIcon class="size-3.5 text-muted-foreground" />
              <span class="truncate">packages</span>
            </div>
            <div
              class="flex items-center gap-2 rounded-md bg-selected px-2 py-1"
            >
              <FileIcon class="size-3.5 text-muted-foreground" />
              <span class="truncate">App.svelte</span>
            </div>
            <div
              class="flex items-center gap-2 rounded-md bg-accent px-2 py-1 text-accent-foreground"
            >
              <FileIcon class="size-3.5" />
              <span class="truncate">hover row</span>
            </div>
          </div>
        </div>
        <div class="relative flex min-w-0 flex-1 flex-col bg-background">
          <div class="flex flex-col gap-3 p-4">
            <div class="flex flex-col gap-2 rounded-md border bg-card p-3">
              <div class="flex items-center gap-2">
                <span class="text-ui font-medium text-foreground">Card</span>
                <Badge variant="info"
                  ><GitBranchIcon data-icon="inline-start" />main</Badge
                >
                <Badge variant="warning">2 pending</Badge>
              </div>
              <span class="text-ui text-muted-foreground"
                >Raised content on the workspace background.</span
              >
              <div class="flex gap-2">
                <Button variant="outline">Cancel</Button>
                <Button>Save</Button>
              </div>
            </div>
            <div
              class="rounded-md border bg-well p-3 font-mono text-ui text-muted-foreground"
            >
              $ pnpm exec tsx --test session.test.ts<br />✔ 12 passed
            </div>
          </div>
          <div
            class="absolute right-4 bottom-4 w-52 rounded-md border bg-popover p-3 shadow-overlay"
          >
            <span class="text-ui font-medium text-foreground">Popover</span>
            <p class="text-ui text-muted-foreground">
              Floating layer with shadow-overlay.
            </p>
          </div>
        </div>
      </div>
    </GallerySpecimen>
  </GalleryGroup>
</div>
