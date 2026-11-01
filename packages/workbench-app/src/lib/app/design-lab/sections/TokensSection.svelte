<script lang="ts">
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import FileIcon from "@lucide/svelte/icons/file";
import FolderIcon from "@lucide/svelte/icons/folder";
import GitBranchIcon from "@lucide/svelte/icons/git-branch";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";

/** `box` paints the swatch itself; `inner`, when set, is layered on top. */
type Swatch = { name: string; role: string; box: string; inner?: string };

const swatches: Swatch[] = [
  {
    name: "background",
    role: "Workspace",
    box: "border bg-background text-foreground",
  },
  {
    name: "card",
    role: "Raised content",
    box: "border bg-card text-card-foreground",
  },
  {
    name: "popover",
    role: "Floating layers",
    box: "border bg-popover text-popover-foreground",
  },
  {
    name: "panel",
    role: "Shell and dock chrome",
    box: "border bg-panel text-foreground",
  },
  {
    name: "well",
    role: "Recessed output",
    box: "border bg-well text-foreground",
  },
  {
    name: "muted",
    role: "Quiet resting fill",
    box: "border bg-muted text-muted-foreground",
  },
  {
    name: "hover",
    role: "Neutral hover and menu highlight",
    box: "border bg-background text-foreground",
    inner: "bg-hover",
  },
  {
    name: "selected",
    role: "Persistent selection",
    box: "border bg-selected text-foreground",
  },
  {
    name: "border",
    role: "Hairlines",
    box: "border border-border bg-background text-foreground",
  },
  {
    name: "input",
    role: "Field borders",
    box: "border border-input bg-background text-foreground",
  },
  {
    name: "primary",
    role: "Brand: one solid action per view",
    box: "border bg-primary text-primary-foreground",
  },
  {
    name: "destructive-solid",
    role: "Destructive fills",
    box: "border bg-destructive-solid text-destructive-solid-foreground",
  },
  {
    name: "destructive",
    role: "Readable red text",
    box: "border bg-background text-destructive",
  },
  {
    name: "success",
    role: "Status text and dots",
    box: "border bg-background text-success",
  },
  {
    name: "warning",
    role: "Status text and dots",
    box: "border bg-background text-warning",
  },
  {
    name: "info",
    role: "Status text and dots",
    box: "border bg-background text-info",
  },
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

/* Full literal class names per tone so Tailwind can see every utility. */
const recipes = [
  {
    name: "primary",
    text: "text-primary",
    subtle: "bg-primary-subtle",
    strong: "border-primary-strong",
  },
  {
    name: "info",
    text: "text-info",
    subtle: "bg-info-subtle",
    strong: "border-info-strong",
  },
  {
    name: "success",
    text: "text-success",
    subtle: "bg-success-subtle",
    strong: "border-success-strong",
  },
  {
    name: "warning",
    text: "text-warning",
    subtle: "bg-warning-subtle",
    strong: "border-warning-strong",
  },
  {
    name: "destructive",
    text: "text-destructive",
    subtle: "bg-destructive-subtle",
    strong: "border-destructive-strong",
  },
] as const;

const statusTones: StatusTone[] = [
  "neutral",
  "brand",
  "info",
  "success",
  "warning",
  "destructive",
];

const radii = [
  "rounded-sm",
  "rounded-md",
  "rounded-lg",
  "rounded-xl",
  "rounded-full",
] as const;

const shadows = [
  {
    name: "shadow-sm",
    cls: "shadow-sm",
    role: "Raised cards (controls stay flat)",
  },
  {
    name: "shadow-overlay",
    cls: "shadow-overlay",
    role: "Popovers, menus, dialogs, tooltips, floating toolbars",
  },
] as const;
</script>

<div class="flex flex-col gap-10">
  <GalleryGroup
    title="Surfaces"
    description="well < panel < background < card < popover. Pick the surface that matches the role, never a shade."
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
  </GalleryGroup>

  <GalleryGroup
    title="Colours"
    description="Theme tokens plus recipes derived once in theme.css. App code never adds its own alpha or color-mix."
  >
    <GallerySpecimen
      title="Colour tokens"
      source="styles/theme.css"
      layout="bare"
    >
      <div class="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
        {#each swatches as swatch (swatch.name)}
          <div class="flex flex-col gap-1">
            <div
              class="relative flex h-12 items-end overflow-hidden rounded-md p-2 text-ui {swatch.box}"
            >
              {#if swatch.inner}
                <div class="absolute inset-2 rounded-sm {swatch.inner}"></div>
              {/if}
              <span class="relative">Aa</span>
            </div>
            <span class="text-ui text-foreground">{swatch.name}</span>
            <span class="text-caption text-muted-foreground">{swatch.role}</span
            >
          </div>
        {/each}
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Derived recipes"
      description="subtle is an 8% tint for chips, callouts and soft fills; strong is 40% for tinted borders, rings and marks."
      source="styles/theme.css"
      layout="bare"
    >
      <div
        class="grid grid-cols-[6rem_repeat(3,minmax(8rem,1fr))_minmax(14rem,2fr)] items-center gap-3"
      >
        <span class="text-caption text-muted-foreground">tone</span>
        <span class="font-mono text-caption text-muted-foreground"
          >text-&lt;tone&gt;</span
        >
        <span class="font-mono text-caption text-muted-foreground"
          >bg-&lt;tone&gt;-subtle</span
        >
        <span class="font-mono text-caption text-muted-foreground"
          >border-&lt;tone&gt;-strong</span
        >
        <span class="text-caption text-muted-foreground">callout</span>
        {#each recipes as tone (tone.name)}
          <span class="text-ui text-foreground">{tone.name}</span>
          <div class="flex">
            <span class="rounded-md bg-background px-2 py-1 text-ui {tone.text}"
              >Sample</span
            >
          </div>
          <div class="flex">
            <span
              class="rounded-md px-2 py-0.5 text-ui {tone.subtle} {tone.text}"
              >Chip</span
            >
          </div>
          <div class="flex">
            <span
              class="rounded-md border px-2 py-0.5 text-ui text-foreground {tone.strong}"
              >Bordered</span
            >
          </div>
          <div
            class="flex flex-col gap-0.5 rounded-md border p-2 {tone.strong} {tone.subtle}"
          >
            <span class="text-ui font-medium {tone.text}">{tone.name}</span>
            <span class="text-ui text-foreground"
              >A callout pairs the tinted fill with a strong border.</span
            >
          </div>
        {/each}
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Neutral recipes"
      source="styles/theme.css"
      layout="bare"
    >
      <div class="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-4">
        <div class="flex flex-col gap-1.5">
          <span class="font-mono text-caption text-muted-foreground"
            >border-border-subtle</span
          >
          <div class="flex flex-col rounded-md border bg-card text-ui">
            <span class="px-2 py-1.5 text-foreground">First row</span>
            <span
              class="border-t border-border-subtle px-2 py-1.5 text-foreground"
              >Second row</span
            >
          </div>
          <span class="text-caption text-muted-foreground"
            >Dividers inside a bordered surface</span
          >
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="font-mono text-caption text-muted-foreground"
            >ring-focus</span
          >
          <div
            class="flex h-control items-center rounded-md border border-ring px-2 text-ui text-foreground ring-3 ring-focus"
          >
            Focused field
          </div>
          <span class="text-caption text-muted-foreground">Focus halo</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="font-mono text-caption text-muted-foreground"
            >bg-scrim</span
          >
          <div
            class="relative flex flex-col gap-0.5 overflow-hidden rounded-md border bg-card p-2"
          >
            <span class="text-ui font-medium text-foreground">Card</span>
            <span class="text-ui text-muted-foreground"
              >Content behind a modal overlay.</span
            >
            <div class="absolute inset-y-0 right-0 w-1/2 bg-scrim"></div>
          </div>
          <span class="text-caption text-muted-foreground"
            >Dim layer behind modals</span
          >
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="font-mono text-caption text-muted-foreground"
            >bg-hover</span
          >
          <div class="flex flex-col rounded-md border bg-card p-1 text-ui">
            <span class="rounded-sm px-2 py-1 text-foreground">Resting row</span
            >
            <span class="rounded-sm bg-hover px-2 py-1 text-foreground"
              >Hovered row</span
            >
          </div>
          <span class="text-caption text-muted-foreground"
            >Works on any surface</span
          >
        </div>
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Status tones"
    description="One vocabulary for status. brand is the primary colour for things the app highlights (Default, meters); text strength is foreground vs muted, never a tone."
  >
    <GallerySpecimen title="StatusTone" source="display/status" layout="bare">
      <div class="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-4">
        {#each statusTones as tone (tone)}
          <div class="flex flex-col items-start gap-2">
            <span class="text-caption text-muted-foreground">{tone}</span>
            <StatusDot {tone} size="md" />
            <Badge variant={tone}>{tone}</Badge>
          </div>
        {/each}
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Radius & elevation"
    description="Global radii and the two elevations; themes own colour only."
  >
    <GallerySpecimen title="Radius" layout="bare">
      <div class="flex flex-wrap gap-4">
        {#each radii as radius (radius)}
          <div class="flex flex-col items-center gap-1.5">
            <div class="size-14 border bg-card {radius}"></div>
            <span class="text-ui text-muted-foreground">{radius}</span>
          </div>
        {/each}
      </div>
    </GallerySpecimen>

    <GallerySpecimen title="Elevation" layout="bare">
      <div class="flex flex-wrap gap-6 p-2">
        {#each shadows as shadow (shadow.name)}
          <div class="flex w-40 flex-col items-center gap-1.5">
            <div
              class="size-16 rounded-md border bg-popover {shadow.cls}"
            ></div>
            <span class="text-ui text-foreground">{shadow.name}</span>
            <span class="text-center text-caption text-muted-foreground"
              >{shadow.role}</span
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
              class="flex items-center gap-2 rounded-md bg-hover px-2 py-1 text-foreground"
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
