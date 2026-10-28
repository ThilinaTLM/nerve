<script lang="ts">
import ArchiveIcon from "@lucide/svelte/icons/archive";
import ArrowDownToLineIcon from "@lucide/svelte/icons/arrow-down-to-line";
import CopyIcon from "@lucide/svelte/icons/copy";
import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
import EyeIcon from "@lucide/svelte/icons/eye";
import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
import MessageSquarePlusIcon from "@lucide/svelte/icons/message-square-plus";
import PinIcon from "@lucide/svelte/icons/pin";
import SquareCheckIcon from "@lucide/svelte/icons/square-check";
import Trash2Icon from "@lucide/svelte/icons/trash-2";
import Undo2Icon from "@lucide/svelte/icons/undo-2";
import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import ContextMenuList, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/composites/context-menu-list";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import PopoverPanel, {
  PopoverBody,
  PopoverCommandList,
  PopoverViews,
  PopoverFooter,
  PopoverHeader,
  PopoverMeter,
  PopoverProperties,
  PopoverProperty,
  PopoverSearch,
  PopoverSection,
  SelectRow,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import {
  PanelHeader,
  PanelList,
  PanelRow,
  PanelSectionHeader,
  PanelView,
} from "$lib/presentation/panels";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";

type DialogKey = "sm" | "md" | "wide" | "flush" | "search" | "tool";
let dialogOpen = $state<DialogKey | null>(null);
function bindOpen(key: DialogKey) {
  return {
    open: dialogOpen === key,
    onOpenChange: (next: boolean) => (dialogOpen = next ? key : null),
  };
}

let confirmOpen = $state(false);
let destructiveOpen = $state(false);
let lastResult = $state("none yet");
let hideDone = $state(false);

/* ------------------------------- Fixtures ------------------------------- */

const conversations = [
  { id: "c1", title: "Basically, I want to polish the UX in our application" },
  { id: "c2", title: "Make sure both of them follows the same state" },
  {
    id: "c3",
    title: "The plan mode present tool view not showing the body and footer",
  },
  { id: "c4", title: "Why I need to create the conversation in order to" },
  { id: "c5", title: "PR checks are failing can you fix it" },
  { id: "c6", title: "Stage and commit the current changes with a message" },
];
let searchQuery = $state("");
const filteredConversations = $derived(
  conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  ),
);

const models = [
  { id: "gpt", label: "GPT-6.1 Sol", detail: "Medium reasoning" },
  { id: "sonnet", label: "Claude Sonnet 4.5", detail: "Balanced" },
  { id: "opus", label: "Claude Opus 4.1", detail: "Highest capability" },
  { id: "haiku", label: "Claude Haiku 4.5", detail: "Fastest" },
];
let commandChoice = $state<string | null>(null);
let commandEnabled = $state(false);
const commandItems = [
  { key: "search", label: "Search files", group: "Tools", keywords: ["find"] },
  { key: "terminal", label: "Terminal", group: "Tools" },
  { key: "sonnet", label: "Sonnet", group: "Models" },
  { key: "opus", label: "Opus", group: "Models" },
];
let modelQuery = $state("");
let modelSelected = $state("gpt");
const filteredModels = $derived(
  models.filter((m) =>
    m.label.toLowerCase().includes(modelQuery.trim().toLowerCase()),
  ),
);

const projects = [
  { id: "nerve", name: "nerve", dir: "~/Projects/nerve" },
  { id: "events", name: "90Events", dir: "~/Projects/90Events" },
  { id: "pplied", name: "PPlied", dir: "~/Projects/PPlied" },
  { id: "easylink", name: "EasyLink", dir: "~/Projects/EasyLink" },
  { id: "random", name: "Random", dir: "~/Projects/Random" },
];
let projectQuery = $state("");
let projectSelected = $state("nerve");
const filteredProjects = $derived(
  projects.filter((p) =>
    p.name.toLowerCase().includes(projectQuery.trim().toLowerCase()),
  ),
);

function note(label: string) {
  return () => (lastResult = label);
}

const conversationMenu: ContextMenuItem[] = [
  { label: "Open", icon: ExternalLinkIcon, onSelect: note("Open") },
  {
    label: "New chat",
    icon: MessageSquarePlusIcon,
    shortcut: "Ctrl+N",
    onSelect: note("New chat"),
  },
  { type: "separator" },
  { label: "Pin", icon: PinIcon, onSelect: note("Pin") },
  { label: "Mark done", icon: SquareCheckIcon, onSelect: note("Mark done") },
  { label: "Copy ID", icon: CopyIcon, onSelect: note("Copy ID") },
  { type: "separator" },
  {
    label: "Delete",
    icon: Trash2Icon,
    destructive: true,
    onSelect: note("Delete"),
  },
];

const gitFileMenu: ContextMenuItem[] = [
  { label: "View", icon: EyeIcon, onSelect: note("View") },
  { label: "Unstage", icon: ArrowDownToLineIcon, onSelect: note("Unstage") },
  { label: "Stash", icon: ArchiveIcon, onSelect: note("Stash") },
  { type: "separator" },
  {
    label: "Discard",
    icon: Undo2Icon,
    destructive: true,
    onSelect: note("Discard"),
  },
];

const toolOutput = [
  "✔ ask_user answer resolves to the canonical card result (1.60ms)",
  "✔ presenting a plan requests review without changing mode (0.47ms)",
  "✖ approve preserves the reviewed snapshot in completed display data (3.93ms)",
  "ℹ tests 10 · pass 8 · fail 2",
].join("\n");
</script>

<div class="flex flex-col gap-10">
  <GalleryGroup
    title="Dialogs"
    description="Modal chrome on the card surface. Buttons open the real dialogs; sizes are the ones the app uses."
  >
    <GallerySpecimen
      title="DialogShell"
      source="composites/dialog-shell"
      usage="31 files · dialogs, shell, settings"
      description="sm 30rem (settings/forms), md 42rem, wide 60rem (search, tool details), flush for edge-to-edge lists."
    >
      <Button variant="outline" onclick={() => (dialogOpen = "sm")}
        >sm · Conversation settings</Button
      >
      <Button variant="outline" onclick={() => (dialogOpen = "md")}
        >md · Edit profile</Button
      >
      <Button variant="outline" onclick={() => (dialogOpen = "wide")}
        >wide · Tool details</Button
      >
      <Button variant="outline" onclick={() => (dialogOpen = "search")}
        >wide + flush · Conversation search</Button
      >
    </GallerySpecimen>

    <GallerySpecimen
      title="ConfirmDialog"
      source="composites/confirm-dialog"
      usage="28 files · settings, launches, git, projects, dialogs"
      description="Default and destructive. The result of the last choice is shown here."
    >
      <Button variant="outline" onclick={() => (confirmOpen = true)}
        >Default</Button
      >
      <Button variant="destructive" onclick={() => (destructiveOpen = true)}
        >Destructive</Button
      >
      <span class="text-xs text-muted-foreground"
        >Last result: {lastResult}</span
      >
    </GallerySpecimen>

    <DialogShell
      {...bindOpen("sm")}
      size="sm"
      title="Conversation settings"
      description="Choose which conversations appear in the list."
    >
      <div class="flex flex-col gap-3 text-sm">
        <div class="flex items-center justify-between gap-4">
          <div class="flex min-w-0 flex-col">
            <span class="font-medium">Hide completed conversations</span>
            <span class="text-xs text-muted-foreground"
              >Hide conversations you marked as done.</span
            >
          </div>
          <Switch bind:checked={hideDone} />
        </div>
        <div class="flex items-center justify-between gap-4">
          <div class="flex min-w-0 flex-col">
            <span class="font-medium">Clean up conversations</span>
            <span class="text-xs text-muted-foreground"
              >Remove conversations by age or keep only the most recent.</span
            >
          </div>
          <Button variant="outline">Clean up</Button>
        </div>
      </div>
    </DialogShell>

    <DialogShell
      {...bindOpen("md")}
      size="md"
      title="Edit profile"
      description="Header description, scrolling body, footer actions."
    >
      <div class="grid gap-2 text-sm text-muted-foreground">
        {#each ["Name", "Model", "Instructions"] as field (field)}
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-foreground">{field}</span>
            <div class="h-7 rounded-md border bg-background px-2 leading-7">
              {field}
            </div>
          </div>
        {/each}
      </div>
      {#snippet footer()}
        <Button variant="outline" onclick={() => (dialogOpen = null)}
          >Cancel</Button
        >
        <Button onclick={() => (dialogOpen = null)}>Save</Button>
      {/snippet}
    </DialogShell>

    <DialogShell
      {...bindOpen("wide")}
      size="wide"
      title="bash details"
      description="completed · pnpm exec tsx --test src/tool-calls/plan-review-result.test.ts"
    >
      {@render toolDetailsBody()}
    </DialogShell>

    <DialogShell
      {...bindOpen("search")}
      size="wide"
      flush
      title="Conversations"
      description="158 in nerve"
    >
      {@render conversationSearchBody()}
    </DialogShell>

    <ConfirmDialog
      bind:open={confirmOpen}
      title="Restart the daemon?"
      description="Active runs will be paused and resumed once the daemon is back."
      confirmLabel="Restart"
      onConfirm={() => (lastResult = "default confirm")}
      onCancel={() => (lastResult = "default cancel")}
    />
    <ConfirmDialog
      bind:open={destructiveOpen}
      destructive
      title="Delete conversation?"
      description="This permanently removes the conversation and its tool call history. This cannot be undone."
      confirmLabel="Delete"
      onConfirm={() => (lastResult = "destructive confirm")}
      onCancel={() => (lastResult = "destructive cancel")}
    />
  </GalleryGroup>

  <GalleryGroup
    title="Popovers"
    description="PopoverPanel anchored to a trigger. Status-bar and composer panels open upward (side top)."
  >
    <GallerySpecimen
      title="Command list and field family"
      source="composites/popover-panel"
      description="Search group names or items; arrows and Enter choose. Panel details cross-fade and resize."
    >
      <PopoverPanel
        ariaLabel="Command list specimen"
        onOpenChange={() => (commandChoice = null)}
      >
        {#snippet trigger()}{@render fakeTrigger("Panel · Commands")}{/snippet}
        <PopoverViews key={commandChoice}>
          {#if commandChoice}
            <PopoverHeader title={commandChoice} />
            <PopoverBody
              ><p class="px-1.5 text-xs text-muted-foreground">
                This view demonstrates a shorter detail panel.
              </p></PopoverBody
            >
            <PopoverFooter
              ><Button
                variant="ghost"
                size="sm"
                onclick={() => (commandChoice = null)}>Back</Button
              ></PopoverFooter
            >
          {:else}
            <PopoverCommandList
              items={commandItems}
              ariaLabel="Search commands"
              onChoose={(item) => (commandChoice = item.label)}
            />
          {/if}
        </PopoverViews>
      </PopoverPanel>
      <PopoverPanel
        variant="field"
        ariaLabel="Field list specimen"
        triggerClass="w-64 rounded-md border border-input"
      >
        {#snippet triggerChild({ props })}
          <Button {...props} variant="outline" class="w-64"
            >Field · Commands</Button
          >
        {/snippet}
        <PopoverCommandList
          items={commandItems}
          ariaLabel="Search field commands"
          rowMode="container"
          isDisabled={(item) => item.key === "terminal"}
          onChoose={(item) => (lastResult = item.label)}
        >
          {#snippet row(item)}
            <div class="flex items-center justify-between gap-2 px-1.5 py-1">
              <span>{item.label}</span>
              <Switch
                bind:checked={commandEnabled}
                aria-label={`Enable ${item.label}`}
              />
            </div>
          {/snippet}
        </PopoverCommandList>
      </PopoverPanel>
    </GallerySpecimen>
    <GallerySpecimen
      title="PopoverPanel sm / md / lg"
      source="composites/popover-panel"
      usage="17 files · composer, shell, settings, git, projects"
      description="sm 16rem status details, md 20rem model picker / usage, lg 24rem project switcher."
    >
      <PopoverPanel
        size="sm"
        side="top"
        align="start"
        ariaLabel="Daemon status"
        triggerClass="inline-flex"
      >
        {#snippet trigger()}{@render fakeTrigger("sm · Daemon")}{/snippet}
        {@render daemonPanel()}
      </PopoverPanel>

      <PopoverPanel
        size="md"
        side="bottom"
        align="start"
        ariaLabel="Choose model"
        triggerClass="inline-flex"
      >
        {#snippet trigger()}{@render fakeTrigger("md · Model picker")}{/snippet}
        {@render modelPanel()}
      </PopoverPanel>

      <PopoverPanel
        size="md"
        side="top"
        align="start"
        ariaLabel="Subscription usage"
        triggerClass="inline-flex"
      >
        {#snippet trigger()}{@render fakeTrigger("md · Usage")}{/snippet}
        {@render usagePanel()}
      </PopoverPanel>

      <PopoverPanel
        size="lg"
        side="bottom"
        align="start"
        ariaLabel="Projects"
        triggerClass="inline-flex"
      >
        {#snippet trigger()}{@render fakeTrigger("lg · Projects")}{/snippet}
        {@render projectPanel()}
      </PopoverPanel>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Menus & tooltips"
    description="Right-click menus are the app's main menu pattern; dropdown menus only appear in settings, tools and discover."
  >
    <GallerySpecimen
      title="ContextMenuList"
      source="composites/context-menu-list"
      usage="10 files · conversation, editor, shell, git"
      description="Right-click either target: conversation row menu, git changed-file menu."
      layout="stack"
    >
      <div class="grid gap-3 md:grid-cols-2">
        <ContextMenuList items={conversationMenu} triggerClass="block">
          <div
            class="flex h-8 items-center rounded-md border px-2 text-xs text-foreground"
          >
            Conversation row
          </div>
        </ContextMenuList>
        <ContextMenuList items={gitFileMenu} triggerClass="block">
          <div
            class="flex h-8 items-center rounded-md border px-2 text-xs text-foreground"
          >
            Git changed file · App.svelte
          </div>
        </ContextMenuList>
      </div>
      <span class="text-xs text-muted-foreground"
        >Last selection: {lastResult}</span
      >
    </GallerySpecimen>

    <GallerySpecimen
      title="DropdownMenu"
      source="ui/dropdown-menu"
      usage="6 files · settings, tools, shell, git"
      description="Overflow menu as in the sub-agent profile row: items, separator, destructive."
    >
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              variant="ghost"
              size="icon"
              ariaLabel="Profile actions"
              {...props}><EllipsisIcon /></Button
            >
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-56">
          <DropdownMenu.Item>Edit</DropdownMenu.Item>
          <DropdownMenu.Item>Duplicate as new profile</DropdownMenu.Item>
          <DropdownMenu.Item>Copy to project</DropdownMenu.Item>
          <DropdownMenu.Item>Export as JSON</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item>Reset customizations</DropdownMenu.Item>
          <DropdownMenu.Item variant="destructive"
            >Delete profile</DropdownMenu.Item
          >
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </GallerySpecimen>

    <GallerySpecimen
      title="Tooltip"
      source="ui/tooltip"
      usage="17 files · settings, conversation, projects, tools"
      description="Plain label (default side top) and the rich multi-line form used by conversation context actions."
    >
      <Tooltip.Provider delayDuration={200}>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button variant="outline" {...props}>Hover me</Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>New chat (Ctrl+N)</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button variant="outline" {...props}>Rich · top</Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content
            side="top"
            class="max-w-sm flex-col items-stretch gap-1 py-2"
          >
            <div class="flex items-baseline justify-between gap-4">
              <span class="font-medium">Compaction</span>
              <span class="text-muted-foreground">Project</span>
            </div>
            <p class="font-medium">Auto at 80%</p>
            <p class="text-muted-foreground">
              Summarize older turns when the context window fills.
            </p>
            <p class="border-t pt-1 text-muted-foreground">Click to change</p>
          </Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="In context"
    description="Overlays composed as they appear over the workbench, at real desktop dimensions (static replicas of the open state)."
  >
    <GallerySpecimen
      title="Side panel with row context menu"
      description="280px conversations dock. Right-click a row (PanelRow menuItems) for the real menu."
      surface="panel"
      layout="bare"
    >
      <div class="flex flex-wrap items-start gap-6">
        <div class="h-96 w-70 overflow-hidden rounded-md border bg-panel">
          <PanelView>
            <PanelHeader title="Conversations" count={158} class="px-2" />
            <PanelSectionHeader title="Today" count={conversations.length} />
            <PanelList ariaLabel="Today conversations" class="gap-1 pb-0">
              {#each conversations as item, index (item.id)}
                <PanelRow
                  label={item.title}
                  labelLines={2}
                  active={index === 2}
                  menuItems={conversationMenu}
                >
                  {#snippet leading()}
                    <StatusDot
                      tone={index === 2 ? "info" : "neutral"}
                      size="md"
                      variant={index === 2 ? "solid" : "outline"}
                    />
                  {/snippet}
                </PanelRow>
              {/each}
            </PanelList>
          </PanelView>
        </div>

        <div class="flex flex-col gap-3">
          <span class="text-xs text-muted-foreground"
            >Status popover (md, opens upward from the status bar)</span
          >
          <div class="floating-surface popover-content popover-md">
            {@render usagePanel()}
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <span class="text-xs text-muted-foreground"
            >Project switcher (lg, from the titlebar)</span
          >
          <div class="floating-surface popover-content popover-lg">
            {@render projectPanel()}
          </div>
        </div>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Conversation search modal"
      description="Ctrl+K: DialogShell wide + flush, as in the app at ~880px."
      surface="well"
      layout="bare"
    >
      <div
        class="dialog-content mx-auto h-110 w-full max-w-220! translate-none! static!"
      >
        <header class="dialog-header">
          <div class="dialog-title-block">
            <h2 class="dialog-title">Conversations</h2>
            <p class="dialog-description">158 in nerve</p>
          </div>
        </header>
        <div class="dialog-body dialog-body-flush">
          {@render conversationSearchBody()}
        </div>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Tool details modal"
      description="Tool call 'View details': wide DialogShell with collapsible sections."
      surface="well"
      layout="bare"
    >
      <div
        class="dialog-content mx-auto w-full max-w-240! translate-none! static!"
      >
        <header class="dialog-header">
          <div class="dialog-title-block">
            <h2 class="dialog-title">bash details</h2>
            <p class="dialog-description">
              completed · pnpm exec tsx --test
              src/tool-calls/plan-review-result.test.ts
            </p>
          </div>
        </header>
        <div class="dialog-body">
          {@render toolDetailsBody()}
        </div>
      </div>
    </GallerySpecimen>
  </GalleryGroup>
</div>

{#snippet fakeTrigger(label: string)}
  <span
    class="inline-flex h-6 items-center rounded-md border px-2 text-xs text-foreground"
    >{label}</span
  >
{/snippet}

{#snippet daemonPanel()}
  <PopoverHeader title="Nerve daemon" meta="v0.34.1" />
  <PopoverBody>
    <PopoverProperties>
      <PopoverProperty label="Uptime" value="1h 26m" />
      <PopoverProperty label="Index">
        <Badge variant="success">Healthy</Badge>
      </PopoverProperty>
      <PopoverProperty
        label="Data dir"
        value="/home/tlm/Projects/nerve/data/storage-1"
        title="Data directory"
      />
    </PopoverProperties>
  </PopoverBody>
{/snippet}

{#snippet usagePanel()}
  <PopoverHeader title="Subscription usage" meta="Updated 07:28 PM" />
  <PopoverBody>
    <PopoverSection label="Anthropic">
      <PopoverMeter
        label="Session"
        value="38%"
        percent={38}
        caption="resets in 4h"
      />
      <PopoverMeter
        label="Weekly"
        value="21%"
        percent={21}
        caption="resets in 5d 11h"
      />
    </PopoverSection>
    <PopoverSection label="Codex · prolite" separated>
      {#snippet action()}<Badge variant="outline">Active</Badge>{/snippet}
      <PopoverMeter
        label="Weekly"
        value="82%"
        percent={82}
        tone="warning"
        caption="resets in 5d 15h"
      />
    </PopoverSection>
  </PopoverBody>
{/snippet}

{#snippet modelPanel()}
  <PopoverHeader title="Model" meta={`${models.length} available`} />
  <PopoverSearch>
    <SearchInput
      bind:value={modelQuery}
      placeholder="Filter models"
      ariaLabel="Filter models"
    />
  </PopoverSearch>
  <PopoverBody>
    {#each filteredModels as model (model.id)}
      <SelectRow
        label={model.label}
        detail={model.detail}
        selected={modelSelected === model.id}
        onclick={() => (modelSelected = model.id)}
      />
    {:else}
      <p class="px-1.5 py-3 text-center text-muted-foreground">
        No models match.
      </p>
    {/each}
  </PopoverBody>
  <PopoverFooter>
    <Button variant="ghost" size="sm">Manage providers</Button>
  </PopoverFooter>
{/snippet}

{#snippet projectPanel()}
  <PopoverHeader title="Projects" meta="13" />
  <PopoverSearch>
    <SearchInput
      bind:value={projectQuery}
      placeholder="Search projects"
      ariaLabel="Search projects"
    />
  </PopoverSearch>
  <PopoverBody>
    {#each filteredProjects as project (project.id)}
      <SelectRow
        label={project.name}
        detail={project.dir}
        selected={projectSelected === project.id}
        onclick={() => (projectSelected = project.id)}
      />
    {:else}
      <p class="px-1.5 py-3 text-center text-muted-foreground">
        No projects match.
      </p>
    {/each}
  </PopoverBody>
  <PopoverFooter>
    <Button variant="ghost" size="sm"
      ><FolderOpenIcon />Browse for a project</Button
    >
  </PopoverFooter>
{/snippet}

{#snippet conversationSearchBody()}
  <div class="flex flex-col gap-2 p-3">
    <SearchInput
      bind:value={searchQuery}
      placeholder="Filter conversations"
      ariaLabel="Filter conversations"
    />
    <div class="flex max-h-80 flex-col overflow-y-auto">
      <PanelSectionHeader title="Today" count={filteredConversations.length} />
      {#each filteredConversations as item, index (item.id)}
        <PanelRow label={item.title} dense active={index === 2}>
          {#snippet leading()}
            <StatusDot
              tone={index === 2 ? "info" : "neutral"}
              size="md"
              variant={index === 2 ? "solid" : "outline"}
            />
          {/snippet}
        </PanelRow>
      {:else}
        <p class="px-2 py-6 text-center text-sm text-muted-foreground">
          No conversations match.
        </p>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet toolDetailsBody()}
  <div class="flex flex-col gap-2 text-xs">
    <Badge variant="outline" class="self-start">44 lines</Badge>
    {#each ["Formatted view", "Agent preview", "Arguments", "Complete result · 6,250 bytes"] as section, index (section)}
      <details class="rounded-md border" open={index === 0}>
        <summary class="cursor-pointer px-2 py-1.5 font-medium"
          >{section}</summary
        >
        {#if index === 0}
          <pre
            class="m-2 overflow-x-auto rounded-md bg-well p-2 font-mono text-xs">{toolOutput}</pre>
        {/if}
      </details>
    {/each}
  </div>
{/snippet}
