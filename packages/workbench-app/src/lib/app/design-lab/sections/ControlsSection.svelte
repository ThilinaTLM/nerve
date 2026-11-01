<script lang="ts">
import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
import CopyIcon from "@lucide/svelte/icons/copy";
import DownloadIcon from "@lucide/svelte/icons/download";
import FileTextIcon from "@lucide/svelte/icons/file-text";
import GitBranchIcon from "@lucide/svelte/icons/git-branch";
import GitPullRequestIcon from "@lucide/svelte/icons/git-pull-request";
import InboxIcon from "@lucide/svelte/icons/inbox";
import ListFilterIcon from "@lucide/svelte/icons/list-filter";
import PencilIcon from "@lucide/svelte/icons/pencil";
import PlusIcon from "@lucide/svelte/icons/plus";
import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
import SendIcon from "@lucide/svelte/icons/send";
import SettingsIcon from "@lucide/svelte/icons/settings";
import Trash2Icon from "@lucide/svelte/icons/trash-2";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import ProgressRing from "@nervekit/ui-kit/components/composites/progress-ring";
import RadioGroupField, {
  type RadioItem,
} from "@nervekit/ui-kit/components/composites/radio-group-field";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import SelectField, {
  type SelectItem,
} from "@nervekit/ui-kit/components/composites/select-field";
import { SplitButton } from "@nervekit/ui-kit/components/composites/split-button";
import {
  StatusDot,
  type StatusDotSize,
} from "@nervekit/ui-kit/components/composites/status-dot";
import SwitchField from "@nervekit/ui-kit/components/composites/switch-field";
import { Badge, type BadgeVariant } from "@nervekit/ui-kit/components/ui/badge";
import {
  Button,
  type ButtonSize,
  type ButtonVariant,
} from "@nervekit/ui-kit/components/ui/button";
import { Checkbox } from "@nervekit/ui-kit/components/ui/checkbox";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Kbd } from "@nervekit/ui-kit/components/ui/kbd";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import * as RadioGroup from "@nervekit/ui-kit/components/ui/radio-group";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import * as Tabs from "@nervekit/ui-kit/components/ui/tabs";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";

// Variant × size combinations the app actually renders (census).
const buttonCombos: { variant: ButtonVariant; sizes: ButtonSize[] }[] = [
  { variant: "ghost", sizes: ["icon-sm", "icon", "sm", "default"] },
  { variant: "outline", sizes: ["sm", "default"] },
  { variant: "default", sizes: ["default"] },
  { variant: "destructive", sizes: ["default"] },
  { variant: "link", sizes: ["sm"] },
];
const iconSizes: ButtonSize[] = ["icon-sm", "icon"];

const badgeVariants: BadgeVariant[] = [
  "neutral",
  "warning",
  "info",
  "brand",
  "success",
  "destructive",
];

const tones: StatusTone[] = [
  "neutral",
  "brand",
  "info",
  "success",
  "warning",
  "destructive",
];
const dotSizes: StatusDotSize[] = ["xs", "md"];

const modelItems: SelectItem[] = [
  {
    value: "sonnet",
    label: "Claude Sonnet",
    detail: "Balanced speed and quality",
  },
  { value: "opus", label: "Claude Opus", detail: "Highest capability" },
  { value: "legacy", label: "Legacy model (retired)", disabled: true },
  {
    value: "long",
    label:
      "An extremely long model label that should truncate inside the trigger",
  },
];

const radioItems: RadioItem[] = [
  {
    value: "ask",
    label: "Ask every time",
    detail: "Prompt before running commands.",
  },
  {
    value: "auto",
    label: "Auto-approve safe",
    detail: "Only prompt for risky operations.",
  },
  {
    value: "locked",
    label: "Locked by policy",
    detail: "Managed by your organisation.",
    disabled: true,
  },
];

const filters = [
  { id: "all", label: "All", count: 24 },
  { id: "open", label: "Open", count: 8 },
  { id: "done", label: "Done", count: 16 },
];

let searchEmpty = $state("");
let searchFilled = $state("auth middleware");
let inputValue = $state("packages/workbench-app");
let notes = $state("");
let selectValue = $state("sonnet");
let selectLong = $state("long");
let selectEmpty = $state("");
let switchOn = $state(true);
let switchOff = $state(false);
let rawSwitch = $state(true);
let checked = $state(true);
let radio = $state("medium");
let radioField = $state("ask");
let chip = $state("all");
let chipSm = $state("open");
let outlineDefault = $state("auto");
let outlineSm = $state("dark");
let open = $state(true);
let openB = $state(false);
let progress = $state(10);

// Context-section state
let ctxSearch = $state("");
let ctxFilter = $state("all");
let ctxMode = $state("auto");
let ctxNotify = $state(true);
let ctxHeaderStyle = $state("auto");
const headerStyleItems: SelectItem[] = [
  { value: "auto", label: "Auto" },
  { value: "linux", label: "Linux" },
  { value: "windows", label: "Windows" },
  { value: "macos", label: "macOS" },
];

$effect(() => {
  const id = setInterval(() => {
    progress = progress >= 100 ? 0 : progress + 10;
  }, 800);
  return () => clearInterval(id);
});
</script>

<div class="flex flex-col gap-10">
  <GalleryGroup
    title="Control scale"
    description="Two height tokens drive every interactive control. Never add a size level and never patch a height through class."
  >
    <GallerySpecimen
      title="--spacing-control · --spacing-control-sm"
      description="28px and 24px on fine pointers; 36px and 32px under @media (pointer: coarse), so touch targets grow without per-component rules."
      source="styles/theme.css"
      layout="stack"
    >
      <div class="flex flex-wrap items-end gap-6">
        <div class="flex flex-col items-start gap-1.5">
          <span class="text-ui text-muted-foreground"
            >control · 28px (coarse 36px)</span
          >
          <div class="flex items-center gap-2">
            <Button>Button</Button>
            <Input value="Input" class="w-28" ariaLabel="Input" />
            <ToggleGroup.Root type="single" spacing={1} value="a">
              <ToggleGroup.Item value="a">Toggle</ToggleGroup.Item>
              <ToggleGroup.Item value="b">Group</ToggleGroup.Item>
            </ToggleGroup.Root>
          </div>
        </div>
        <div class="flex flex-col items-start gap-1.5">
          <span class="text-ui text-muted-foreground"
            >control-sm · 24px (coarse 32px)</span
          >
          <div class="flex items-center gap-2">
            <Button size="sm">Button sm</Button>
            <IconAction icon={PencilIcon} label="Edit" />
            <ToggleGroup.Root type="single" size="sm" spacing={1} value="a">
              <ToggleGroup.Item value="a">Toggle</ToggleGroup.Item>
              <ToggleGroup.Item value="b">Group</ToggleGroup.Item>
            </ToggleGroup.Root>
          </div>
        </div>
      </div>
      <ul class="grid gap-1 text-ui text-muted-foreground">
        <li>
          <span class="text-foreground">control</span> — Button default / icon, Input,
          Textarea (min), SearchInput, Select / SelectField, ToggleGroup default
        </li>
        <li>
          <span class="text-foreground">control-sm</span> — Button sm / icon-sm, IconAction,
          ToggleGroup sm
        </li>
        <li>
          <span class="text-foreground">fixed, single size</span> — Switch, Checkbox,
          Radio, Tabs (underline only)
        </li>
      </ul>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Buttons"
    description="Four sizes — default (28px), sm (24px), icon, icon-sm — across the variants the app renders. ghost dominates; success appears only inside SplitButton."
  >
    <GallerySpecimen
      title="Variant × size"
      source="ui/button"
      usage="120 files · dialogs, shell, conversation, settings, git"
      layout="stack"
    >
      {#each buttonCombos as combo (combo.variant)}
        <div class="flex flex-wrap items-center gap-3">
          <span class="w-20 text-ui text-muted-foreground">{combo.variant}</span
          >
          {#each combo.sizes as size (size)}
            {#if size?.startsWith("icon")}
              <Button variant={combo.variant} {size} ariaLabel="Settings">
                <SettingsIcon />
              </Button>
            {:else}
              <Button variant={combo.variant} {size}>
                {size}
              </Button>
            {/if}
          {/each}
        </div>
      {/each}
    </GallerySpecimen>

    <GallerySpecimen
      title="Icon buttons & inline icons"
      description="icon (28px) and icon-sm (24px) squares; icons sit inline-start / inline-end."
    >
      {#each iconSizes as size (size)}
        <Button variant="ghost" {size} ariaLabel="Delete"><Trash2Icon /></Button
        >
      {/each}
      <Button variant="outline" size="sm"
        ><RefreshCwIcon data-icon="inline-start" />Sync</Button
      >
      <Button variant="outline"
        ><PlusIcon data-icon="inline-start" />New note</Button
      >
      <Button>Send<SendIcon data-icon="inline-end" /></Button>
    </GallerySpecimen>

    <GallerySpecimen
      title="States"
      description="Disabled, loading, active (toolbar), pressed."
    >
      <Button disabled>Disabled</Button>
      <Button variant="outline" disabled>Disabled</Button>
      <Button disabled><Spinner data-icon="inline-start" />Saving…</Button>
      <Button variant="outline" size="sm" disabled
        ><Spinner
          variant="refresh"
          data-icon="inline-start"
        />Refreshing</Button
      >
      <Button variant="ghost" size="icon" active ariaLabel="Active"
        ><FileTextIcon /></Button
      >
      <Button variant="ghost" size="icon" pressed={true} ariaLabel="Pressed"
        ><GitBranchIcon /></Button
      >
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup title="Actions">
    <GallerySpecimen
      title="IconAction"
      description="Icon-only button with built-in tooltip, one size (24px, --spacing-control-sm): default and destructive, plus active / busy / disabled."
      source="composites/icon-action"
      usage="14 files · settings, composer, launches, conversation"
    >
      <IconAction icon={PencilIcon} label="Edit" />
      <IconAction icon={Trash2Icon} label="Delete" tone="destructive" />
      <IconAction icon={RefreshCwIcon} label="Refreshing…" busy />
      <IconAction icon={CopyIcon} label="Copy (disabled)" disabled />
      <IconAction icon={PencilIcon} label="Active" active />
    </GallerySpecimen>

    <GallerySpecimen
      title="SplitButton"
      description="Merge (success), approvals (default sm) and plan accept (outline-style via variant)."
      source="composites/split-button"
      usage="3 files · tools, git"
    >
      {@render split("success", "sm", false, "Merge")}
      {@render split("default", "sm", false, "Approve")}
      {@render split("outline", "sm", false, "Accept plan")}
      {@render split("success", "sm", true, "Merge")}
    </GallerySpecimen>

    <GallerySpecimen
      title="Kbd"
      description="Shortcut hints."
      source="ui/kbd"
      usage="1 file · shell"
    >
      <Kbd>Esc</Kbd>
      <span class="inline-flex items-center gap-1"
        ><Kbd>Ctrl</Kbd><Kbd>Shift</Kbd><Kbd>P</Kbd></span
      >
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Badges & status"
    description="Status meaning is carried by text or an icon, never colour alone."
  >
    <GallerySpecimen
      title="Badge"
      source="ui/badge"
      usage="42 files · settings, git, tools, shell"
    >
      {#each badgeVariants as variant (variant)}
        <Badge {variant}>{variant}</Badge>
      {/each}
      <Badge variant="brand" onclick={() => {}}>View details</Badge>
      <Badge variant="info"
        ><GitBranchIcon data-icon="inline-start" />main</Badge
      >
      <Badge variant="info" class="max-w-40"
        >feature/very-long-branch-name-that-overflows</Badge
      >
    </GallerySpecimen>

    <GallerySpecimen
      title="StatusDot"
      description="Tone is always dynamic in the app; sizes xs and md; solid and outline."
      source="composites/status-dot"
      usage="9 files · shell, settings, projects, tools, conversation"
      layout="stack"
    >
      {#each dotSizes as size (size)}
        <div class="flex flex-wrap items-center gap-4">
          <span class="w-8 text-ui text-muted-foreground">{size}</span>
          {#each tones as tone (tone)}
            <span class="inline-flex items-center gap-1.5 text-ui">
              <StatusDot {tone} {size} label={tone} />{tone}
            </span>
          {/each}
          <StatusDot tone="neutral" {size} variant="outline" />
          <StatusDot tone="success" {size} pulse />
        </div>
      {/each}
    </GallerySpecimen>

    <GallerySpecimen
      title="Spinner · ProgressRing · Progress"
      source="ui/spinner, composites/progress-ring, ui/progress"
      usage="spinner 32 files · git, shell, dialogs, tools; ring 2 · composer; progress 4 · shell"
      layout="stack"
    >
      <div class="flex flex-wrap items-center gap-4">
        <Spinner class="size-3.5" />
        <Spinner class="size-4" />
        <Spinner variant="refresh" class="size-3.5 text-muted-foreground" />
        <span class="flex items-center gap-2 text-ui text-muted-foreground">
          <Spinner class="size-3.5" />Connecting to daemon…
        </span>
        <ProgressRing percent={18} tone="info" />
        <ProgressRing percent={60} tone="warning" />
        <ProgressRing percent={92} tone="destructive" />
      </div>
      <div class="flex max-w-sm items-center gap-3">
        <Progress value={progress} aria-label="Usage" />
        <span class="w-9 text-ui text-muted-foreground">{progress}%</span>
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Text fields"
    description="Every field shares one 28px height (--spacing-control) and takes no size prop."
  >
    <GallerySpecimen
      title="Input · Textarea · Label"
      source="ui/input, ui/textarea, ui/label"
      usage="input 22 files · dialogs, settings; textarea 11 · dialogs, settings, notes"
      layout="stack"
      class="max-w-md"
      surface="card"
    >
      <div class="flex flex-col gap-1.5">
        <Label for="ctl-name">Workspace name</Label>
        <Input id="ctl-name" bind:value={inputValue} />
      </div>
      <div class="flex flex-col gap-1.5">
        <Label for="ctl-name-d">Placeholder</Label>
        <Input id="ctl-name-d" placeholder="my-project" />
      </div>
      <div class="grid grid-cols-2 gap-2">
        <Input value="Disabled" disabled ariaLabel="Disabled" />
        <Input value="bad//branch" aria-invalid="true" ariaLabel="Invalid" />
      </div>
      <Textarea
        bind:value={notes}
        placeholder="Add notes for this conversation…"
        aria-label="Notes"
      />
    </GallerySpecimen>

    <GallerySpecimen
      title="SearchInput"
      description="Same 28px height as Input. The clear button appears once there is a value."
      source="composites/search-input"
      usage="20 files · dialogs, settings, projects, composer"
      layout="stack"
    >
      <div class="grid max-w-md gap-3">
        <SearchInput bind:value={searchEmpty} placeholder="Filter files" />
        <SearchInput bind:value={searchFilled} />
        <SearchInput value="" disabled placeholder="Disabled" />
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="SelectField"
      description="Per-item detail, disabled items, placeholder, long-label truncation."
      source="composites/select-field"
      usage="12 files · dialogs, settings"
      layout="stack"
    >
      <div class="grid max-w-sm gap-3">
        <SelectField
          items={modelItems}
          bind:value={selectValue}
          ariaLabel="Model"
        />
        <SelectField
          items={modelItems}
          bind:value={selectEmpty}
          placeholder="Choose a model"
          ariaLabel="Model"
        />
        <SelectField
          items={modelItems}
          bind:value={selectLong}
          ariaLabel="Model"
        />
        <SelectField
          items={modelItems}
          value="opus"
          disabled
          ariaLabel="Model"
        />
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup title="Toggles">
    <GallerySpecimen
      title="Switch · SwitchField"
      description="One size. SwitchField is a label + description with a switch."
      source="ui/switch, composites/switch-field"
      usage="switch 12 files · settings, dialogs, conversation; field 4 · projects"
      layout="stack"
      surface="card"
    >
      <div class="flex items-center gap-6">
        <label class="flex items-center gap-2 text-ui">
          <Switch bind:checked={rawSwitch} />Switch
        </label>
        <Switch checked disabled aria-label="Disabled on" />
        <Switch disabled aria-label="Disabled off" />
      </div>
      <div class="grid max-w-md gap-3">
        <SwitchField
          bind:checked={switchOn}
          label="Notify on completion"
          description="Show a desktop notification when a run finishes."
        />
        <SwitchField bind:checked={switchOff} label="Auto-compact context" />
        <SwitchField checked label="Managed by policy" disabled />
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Checkbox · RadioGroup · RadioGroupField"
      description="One size each. RadioGroupField adds a label and detail per option."
      source="ui/checkbox, ui/radio-group, composites/radio-group-field"
      usage="checkbox 3 files · settings; radio 2 · settings; field 1 · dialogs"
      layout="stack"
    >
      <div class="flex items-center gap-2">
        <Checkbox id="ctl-cb" bind:checked />
        <Label for="ctl-cb">Auto-approve read-only tools</Label>
        <Checkbox disabled aria-label="Disabled" />
      </div>
      <RadioGroup.Root bind:value={radio} class="flex items-center gap-4">
        {#each ["low", "medium", "high"] as level (level)}
          <div class="flex items-center gap-1.5">
            <RadioGroup.Item value={level} id="ctl-r-{level}" />
            <Label for="ctl-r-{level}" class="capitalize">{level}</Label>
          </div>
        {/each}
      </RadioGroup.Root>
      <div class="max-w-md">
        <RadioGroupField
          items={radioItems}
          bind:value={radioField}
          ariaLabel="Approval mode"
        />
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="ToggleGroup"
      description="chip and outline, each at default (28px) and sm (24px). The app always passes spacing={1}."
      source="ui/toggle-group"
      usage="13 files · settings, composer, git, dialogs"
      layout="stack"
    >
      <div class="flex flex-wrap items-center gap-4">
        <span class="w-24 text-ui text-muted-foreground">chip · default</span>
        <ToggleGroup.Root
          type="single"
          variant="chip"
          spacing={1}
          bind:value={chipSm}
        >
          {#each filters as f (f.id)}
            <ToggleGroup.Item value={f.id}>{f.label}</ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>
        <span class="w-24 text-ui text-muted-foreground">chip · sm</span>
        <ToggleGroup.Root
          type="single"
          variant="chip"
          size="sm"
          spacing={1}
          bind:value={chip}
        >
          {#each filters as f (f.id)}
            <ToggleGroup.Item value={f.id} class="flex-none"
              >{f.label}<span data-slot="toggle-count">{f.count}</span
              ></ToggleGroup.Item
            >
          {/each}
        </ToggleGroup.Root>
      </div>
      <div class="flex flex-wrap items-center gap-4">
        <span class="w-24 text-ui text-muted-foreground">outline · default</span
        >
        <ToggleGroup.Root
          type="single"
          variant="outline"
          spacing={1}
          bind:value={outlineSm}
        >
          <ToggleGroup.Item value="light">Light</ToggleGroup.Item>
          <ToggleGroup.Item value="dark">Dark</ToggleGroup.Item>
        </ToggleGroup.Root>
        <span class="w-24 text-ui text-muted-foreground">outline · sm</span>
        <ToggleGroup.Root
          type="single"
          variant="outline"
          size="sm"
          spacing={1}
          bind:value={outlineDefault}
        >
          <ToggleGroup.Item value="auto">Auto</ToggleGroup.Item>
          <ToggleGroup.Item value="native">Native</ToggleGroup.Item>
          <ToggleGroup.Item value="custom">Custom</ToggleGroup.Item>
        </ToggleGroup.Root>
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup title="Navigation & disclosure">
    <GallerySpecimen
      title="Tabs"
      description="Chrome tab strip like the editor and dock tabs: the active tab takes the content surface under a primary top rule. Plain and with an icon."
      source="ui/tabs"
      usage="3 files · git, settings"
      layout="stack"
    >
      <Tabs.Root value="files">
        <Tabs.List>
          <Tabs.Trigger value="files">Overview</Tabs.Trigger>
          <Tabs.Trigger value="checks">Checks</Tabs.Trigger>
          <Tabs.Trigger value="diff" disabled>Files</Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>
      <Tabs.Root value="general">
        <Tabs.List>
          <Tabs.Trigger value="general"><FileTextIcon />General</Tabs.Trigger>
          <Tabs.Trigger value="tools">Tools</Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>
    </GallerySpecimen>

    <GallerySpecimen
      title="Collapsible"
      source="ui/collapsible"
      usage="5 files · settings, dialogs, shell"
      surface="card"
      layout="stack"
      class="max-w-sm"
    >
      <Collapsible.Root bind:open class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-ui font-medium">3 changed files</span>
          <Collapsible.Trigger>
            {#snippet child({ props })}
              <Button
                variant="ghost"
                size="icon-sm"
                ariaLabel="Toggle"
                {...props}><ChevronsUpDownIcon /></Button
              >
            {/snippet}
          </Collapsible.Trigger>
        </div>
        <div class="rounded-md border px-3 py-1 text-ui">src/App.svelte</div>
        <Collapsible.Content class="flex flex-col gap-2">
          <div class="rounded-md border px-3 py-1 text-ui">
            src/lib/app/App.svelte
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
      <Collapsible.Root bind:open={openB}>
        <Collapsible.Trigger>
          {#snippet child({ props })}
            <Button variant="outline" size="sm" {...props}
              >{openB ? "Hide" : "Show"} details</Button
            >
          {/snippet}
        </Collapsible.Trigger>
        <Collapsible.Content>
          <p class="pt-2 text-ui text-muted-foreground">Hidden details.</p>
        </Collapsible.Content>
      </Collapsible.Root>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup title="Loading & empty">
    <GallerySpecimen
      title="Skeleton"
      description="Git panel loading rows."
      source="ui/skeleton"
      usage="12 files · git, settings, tools"
      surface="panel"
      layout="stack"
      class="max-w-xs"
    >
      {#each [0, 1, 2, 3] as row (row)}
        <div class="flex items-center gap-2">
          <Skeleton class="size-4 shrink-0" />
          <Skeleton class="h-4 flex-1" />
          <Skeleton class="h-4 w-8" />
        </div>
      {/each}
    </GallerySpecimen>

    <GallerySpecimen
      title="Empty"
      description="Icon media + title + description + optional action."
      source="ui/empty"
      usage="10 files · git, panels"
      layout="bare"
      surface="panel"
    >
      <div class="max-w-xs">
        <Empty.Root>
          <Empty.Header>
            <Empty.Media variant="icon"><InboxIcon /></Empty.Media>
            <Empty.Title>No scratch notes yet</Empty.Title>
            <Empty.Description
              >Notes are scoped to this project.</Empty.Description
            >
          </Empty.Header>
          <Empty.Content>
            <Button variant="outline" size="sm"
              ><PlusIcon data-icon="inline-start" />New note</Button
            >
          </Empty.Content>
        </Empty.Root>
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="In context"
    description="Controls composed as they appear in the workbench, at real widths."
  >
    <GallerySpecimen
      title="Panel toolbar (280px)"
      description="Git panel header, action row and a PR row, as in the right dock."
      layout="bare"
      surface="panel"
      class="p-0"
    >
      <div class="flex w-[280px] max-w-full flex-col">
        <div class="flex h-8 items-center gap-1.5 px-3 text-ui">
          <span class="font-semibold text-foreground">Git changes</span>
          <span class="text-muted-foreground">28</span>
          <span class="ml-auto flex items-center gap-0.5">
            <IconAction icon={DownloadIcon} label="Stage all" />
            <IconAction icon={RefreshCwIcon} label="Refresh" />
          </span>
        </div>
        <div class="flex items-center gap-1.5 px-3 pb-1.5">
          <Button variant="outline" class="min-w-0 flex-1 justify-between"
            ><span class="flex min-w-0 items-center gap-1.5"
              ><GitBranchIcon data-icon="inline-start" /><span class="truncate"
                >fix/retain-resolved-plan-review-cards</span
              ></span
            ><ChevronsUpDownIcon data-icon="inline-end" /></Button
          >
        </div>
        <div class="flex flex-wrap gap-1.5 px-3 pb-2">
          <Button variant="outline" size="sm">Stashes (1)</Button>
          <Button variant="outline" size="sm">Fetch</Button>
          <Button variant="outline" size="sm"
            ><RefreshCwIcon data-icon="inline-start" />Sync</Button
          >
          <Button variant="outline" size="sm" disabled
            ><Spinner data-icon="inline-start" />Pulling</Button
          >
        </div>
        <div class="mx-1.5 flex flex-col gap-1 rounded-md bg-card px-2 py-1.5">
          <div class="flex items-center gap-1.5 text-ui">
            <GitPullRequestIcon class="size-3.5 text-success" />
            <span class="font-medium text-foreground">#423</span>
            <span class="truncate text-muted-foreground">ThilinaTLM · 56m</span>
            <StatusDot tone="success" class="ml-auto" label="Open" />
          </div>
          <span class="text-ui text-foreground"
            >Fix plan review body and footer</span
          >
          <div class="flex items-center gap-1.5">
            <Badge variant="success">14/14</Badge>
            <span class="ml-auto text-ui text-success">+260</span>
            <span class="text-ui text-destructive">-5</span>
          </div>
        </div>
        <div class="h-2"></div>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Settings form rows (560px)"
      description="Row title + supporting text on the left, control on the right."
      layout="stack"
      class="p-0"
    >
      <div class="flex w-[560px] max-w-full flex-col gap-5 p-4">
        <h2 class="text-title font-semibold text-foreground">Desktop</h2>
        <div class="flex items-start justify-between gap-6">
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-ui text-foreground">Header style</span>
            <span class="text-ui text-muted-foreground"
              >Auto follows your operating system.</span
            >
          </div>
          <SelectField
            items={headerStyleItems}
            bind:value={ctxHeaderStyle}
            ariaLabel="Header style"
            class="w-44"
          />
        </div>
        <SwitchField
          bind:checked={ctxNotify}
          label="Close to system tray"
          description="Hide Nerve in the tray instead of quitting."
        />
        <div class="flex items-center justify-between gap-6">
          <span class="text-ui text-foreground">Color mode</span>
          <ToggleGroup.Root
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            bind:value={ctxMode}
          >
            <ToggleGroup.Item value="auto">System</ToggleGroup.Item>
            <ToggleGroup.Item value="light">Light</ToggleGroup.Item>
            <ToggleGroup.Item value="dark">Dark</ToggleGroup.Item>
          </ToggleGroup.Root>
        </div>
        <div class="flex items-center justify-between gap-6">
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-ui text-foreground">Projects root</span>
            <span class="text-ui text-muted-foreground"
              >Where new workspaces are created.</span
            >
          </div>
          <div class="flex items-center gap-1.5">
            <Input value="~/Projects" class="w-40" ariaLabel="Projects root" />
            <Button variant="outline" size="sm">Browse</Button>
          </div>
        </div>
        <div class="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost">Reset</Button>
          <Button>Save changes</Button>
        </div>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="Filter bar (720px)"
      description="Search, chip filters, status and actions above a list."
      layout="stack"
      surface="panel"
      class="p-0"
    >
      <div class="flex w-[720px] max-w-full flex-col gap-2 p-3">
        <div class="flex items-center gap-2">
          <SearchInput
            bind:value={ctxSearch}
            placeholder="Search conversations"
            class="max-w-xs"
          />
          <ToggleGroup.Root
            type="single"
            variant="chip"
            size="sm"
            spacing={1}
            bind:value={ctxFilter}
          >
            {#each filters as f (f.id)}
              <ToggleGroup.Item value={f.id} class="flex-none"
                >{f.label}<span data-slot="toggle-count">{f.count}</span
                ></ToggleGroup.Item
              >
            {/each}
          </ToggleGroup.Root>
          <span class="ml-auto flex items-center gap-0.5">
            <IconAction icon={ListFilterIcon} label="Filter" />
            <IconAction icon={RefreshCwIcon} label="Refresh" />
            <Button variant="ghost" size="icon-sm" ariaLabel="New"
              ><PlusIcon /></Button
            >
          </span>
        </div>
        <div
          class="flex items-center gap-2 rounded-md bg-card px-2 py-1.5 text-ui"
        >
          <StatusDot tone="success" pulse label="Running" />
          <span class="truncate text-foreground"
            >Investigate flaky timeline test</span
          >
          <Badge variant="neutral">claude-opus</Badge>
          <span class="ml-auto text-ui text-muted-foreground">2m ago</span>
          <Kbd>↵</Kbd>
        </div>
        <div class="flex items-center gap-2 rounded-md px-2 py-1.5 text-ui">
          <StatusDot tone="warning" label="Awaiting approval" />
          <span class="truncate text-foreground">Refactor session store</span>
          <Badge variant="warning">approval</Badge>
          <span class="ml-auto text-ui text-muted-foreground">1h ago</span>
        </div>
      </div>
    </GallerySpecimen>
  </GalleryGroup>
</div>

{#snippet split(
  variant: ButtonVariant,
  size: ButtonSize,
  disabled: boolean,
  label: string,
)}
  <SplitButton {variant} {size} {disabled} triggerLabel="More options">
    {label}
    {#snippet menu()}
      <DropdownMenu.Item>Squash and merge</DropdownMenu.Item>
      <DropdownMenu.Item>Rebase and merge</DropdownMenu.Item>
    {/snippet}
  </SplitButton>
{/snippet}
