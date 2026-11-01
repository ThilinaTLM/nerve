<script lang="ts">
import BoldIcon from "@lucide/svelte/icons/bold";
import CopyIcon from "@lucide/svelte/icons/copy";
import InboxIcon from "@lucide/svelte/icons/inbox";
import ItalicIcon from "@lucide/svelte/icons/italic";
import PlusIcon from "@lucide/svelte/icons/plus";
import SettingsIcon from "@lucide/svelte/icons/settings";
import Trash2Icon from "@lucide/svelte/icons/trash-2";
import { toast } from "svelte-sonner";
import * as AlertDialog from "@nervekit/ui-kit/components/ui/alert-dialog";
import { Badge, type BadgeVariant } from "@nervekit/ui-kit/components/ui/badge";
import {
  Button,
  type ButtonSize,
  type ButtonVariant,
} from "@nervekit/ui-kit/components/ui/button";
import { Checkbox } from "@nervekit/ui-kit/components/ui/checkbox";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
import * as ContextMenu from "@nervekit/ui-kit/components/ui/context-menu";
import * as Dialog from "@nervekit/ui-kit/components/ui/dialog";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Kbd } from "@nervekit/ui-kit/components/ui/kbd";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import * as RadioGroup from "@nervekit/ui-kit/components/ui/radio-group";
import * as Resizable from "@nervekit/ui-kit/components/ui/resizable";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import * as Select from "@nervekit/ui-kit/components/ui/select";
import { Separator } from "@nervekit/ui-kit/components/ui/separator";
import * as Sheet from "@nervekit/ui-kit/components/ui/sheet";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Toaster } from "@nervekit/ui-kit/components/ui/sonner";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import * as Tabs from "@nervekit/ui-kit/components/ui/tabs";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { desktopRuntime } from "$lib/platform/desktop/desktop-bridge.svelte";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";

/*
 * Reference page for the primitives themselves, so it deliberately shows the
 * full variant × size matrix rather than only what the app uses. States are
 * driven by props (disabled, aria-invalid, checked, selected); hover and focus
 * are exercised with the real pointer and keyboard.
 *
 * Overlay content is rendered in place (`portalProps={{ disabled: true }}`) so
 * it inherits the surrounding theme wrapper, which keeps Compare accurate.
 */

const inPlace = { disabled: true } as const;

const buttonVariants: ButtonVariant[] = [
  "default",
  "outline",
  "success",
  "ghost",
  "destructive",
  "link",
];
const buttonSizes: ButtonSize[] = ["default", "sm"];
const badgeVariants: BadgeVariant[] = [
  "neutral",
  "accent",
  "outline",
  "info",
  "success",
  "warning",
  "destructive",
];

let checkboxOn = $state(true);
let switchOn = $state(true);
let radio = $state("b");
let chip = $state("all");
let outline = $state("left");
let selectValue = $state("sonnet");
let tab = $state("one");
let collapsed = $state(true);

const models = [
  { value: "gpt", label: "GPT-6.1 Sol" },
  { value: "sonnet", label: "Claude Sonnet 4.5" },
  { value: "haiku", label: "Claude Haiku 4.5" },
];
const selectedLabel = $derived(
  models.find((m) => m.value === selectValue)?.label ?? "Select a model",
);

let dialogOpen = $state(false);
let alertOpen = $state(false);
let sheetOpen = $state(false);
let menuChecked = $state(true);
let menuRadio = $state("a");

/** Fixed-position overlays are clipped to their frame via a transform. */
const frameClass =
  "relative flex h-72 min-w-0 flex-1 items-start overflow-hidden rounded-md border bg-well p-3 [transform:translateZ(0)]";

const rows = Array.from({ length: 14 }, (_, i) => `Row ${i + 1}`);
</script>

{#if desktopRuntime.isDesktop}
  <!-- The desktop shell uses native notifications and mounts no Toaster. -->
  <Toaster position="bottom-right" closeButton />
{/if}

<Tooltip.Provider>
  <div class="flex flex-col gap-10">
    <GalleryGroup
      title="Actions"
      description="Reference matrix of every variant and size, plus prop-driven states."
    >
      <GallerySpecimen
        title="Button"
        source="ui/button"
        layout="stack"
        description="6 variants × default (28px) and sm (24px); icon and icon-sm squares; disabled and aria-invalid."
      >
        {#each buttonSizes as size (size)}
          <div class="flex flex-wrap items-center gap-3">
            <span class="w-20 text-xs text-muted-foreground">{size}</span>
            {#each buttonVariants as variant (variant)}
              <Button {variant} {size}>{variant}</Button>
            {/each}
          </div>
        {/each}
        <div class="flex flex-wrap items-center gap-3">
          <span class="w-20 text-xs text-muted-foreground">icon</span>
          {#each buttonVariants.filter((v) => v !== "link") as variant (variant)}
            <Button {variant} size="icon" aria-label={variant}
              ><SettingsIcon /></Button
            >
          {/each}
          <span class="w-20 pl-4 text-xs text-muted-foreground">icon-sm</span>
          {#each buttonVariants.filter((v) => v !== "link") as variant (variant)}
            <Button {variant} size="icon-sm" aria-label={variant}
              ><SettingsIcon /></Button
            >
          {/each}
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <span class="w-20 text-xs text-muted-foreground">with icon</span>
          <Button><PlusIcon data-icon="inline-start" />New</Button>
          <Button variant="outline" size="sm"
            ><CopyIcon data-icon="inline-start" />Copy</Button
          >
          <Button variant="destructive"
            ><Trash2Icon data-icon="inline-start" />Delete</Button
          >
          <span class="w-20 pl-4 text-xs text-muted-foreground">loading</span>
          <Button variant="outline" disabled
            ><Spinner data-icon="inline-start" />Saving</Button
          >
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <span class="w-20 text-xs text-muted-foreground">disabled</span>
          {#each buttonVariants as variant (variant)}
            <Button {variant} disabled>{variant}</Button>
          {/each}
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <span class="w-20 text-xs text-muted-foreground">aria-invalid</span>
          {#each buttonVariants as variant (variant)}
            <Button {variant} aria-invalid="true">{variant}</Button>
          {/each}
        </div>
      </GallerySpecimen>

      <GallerySpecimen
        title="Badge"
        source="ui/badge"
        layout="stack"
        description="One colour axis named after the semantic role; single height."
      >
        <div class="flex flex-wrap items-center gap-3">
          {#each badgeVariants as variant (variant)}
            <Badge {variant}>{variant}</Badge>
          {/each}
        </div>
        <div class="flex flex-wrap items-center gap-3">
          {#each badgeVariants as variant (variant)}
            <Badge {variant} aria-invalid="true">{variant} · invalid</Badge>
          {/each}
        </div>
      </GallerySpecimen>

      <GallerySpecimen
        title="ToggleGroup"
        source="ui/toggle-group"
        layout="stack"
        description="chip and outline × default and sm; the pressed item is the selected state."
      >
        {#each ["default", "sm"] as const as size (size)}
          <div class="flex flex-wrap items-center gap-4">
            <span class="w-20 text-xs text-muted-foreground">chip · {size}</span
            >
            <ToggleGroup.Root
              type="single"
              variant="chip"
              {size}
              spacing={1}
              bind:value={chip}
            >
              <ToggleGroup.Item value="all">All</ToggleGroup.Item>
              <ToggleGroup.Item value="open">Open</ToggleGroup.Item>
              <ToggleGroup.Item value="done">Done</ToggleGroup.Item>
              <ToggleGroup.Item value="off" disabled>Disabled</ToggleGroup.Item>
            </ToggleGroup.Root>
            <span class="w-24 text-xs text-muted-foreground"
              >outline · {size}</span
            >
            <ToggleGroup.Root
              type="single"
              variant="outline"
              {size}
              spacing={1}
              bind:value={outline}
            >
              <ToggleGroup.Item value="left" aria-label="Bold"
                ><BoldIcon /></ToggleGroup.Item
              >
              <ToggleGroup.Item value="right" aria-label="Italic"
                ><ItalicIcon /></ToggleGroup.Item
              >
              <ToggleGroup.Item value="off" disabled aria-label="Disabled"
                ><PlusIcon /></ToggleGroup.Item
              >
            </ToggleGroup.Root>
          </div>
        {/each}
      </GallerySpecimen>

      <GallerySpecimen
        title="Tabs"
        source="ui/tabs"
        layout="bare"
        description="Underline-only tab strip; the active tab takes the content surface."
      >
        <Tabs.Root bind:value={tab}>
          <Tabs.List>
            <Tabs.Trigger value="one">Overview</Tabs.Trigger>
            <Tabs.Trigger value="two">Changes</Tabs.Trigger>
            <Tabs.Trigger value="three" disabled>Disabled</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="one" class="p-3 text-sm"
            >Overview content.</Tabs.Content
          >
          <Tabs.Content value="two" class="p-3 text-sm"
            >Changes content.</Tabs.Content
          >
        </Tabs.Root>
      </GallerySpecimen>
    </GalleryGroup>

    <GalleryGroup
      title="Fields"
      description="One size each; invalid and disabled are set through props."
    >
      <GallerySpecimen
        title="Input · Textarea · Label"
        source="ui/input · ui/textarea · ui/label"
        layout="stack"
      >
        <div class="grid max-w-xl grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5">
            <Label for="prim-input">Default</Label>
            <Input id="prim-input" placeholder="Placeholder" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="prim-input-value">With value</Label>
            <Input id="prim-input-value" value="~/Projects/nerve" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="prim-input-invalid">Invalid</Label>
            <Input
              id="prim-input-invalid"
              value="not a path"
              aria-invalid="true"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="prim-input-disabled">Disabled</Label>
            <Input id="prim-input-disabled" value="Locked" disabled />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="prim-textarea">Textarea</Label>
            <Textarea id="prim-textarea" placeholder="Notes" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="prim-textarea-invalid">Textarea · invalid</Label>
            <Textarea
              id="prim-textarea-invalid"
              value="Too long"
              aria-invalid="true"
            />
          </div>
        </div>
      </GallerySpecimen>

      <GallerySpecimen
        title="Checkbox · Switch · RadioGroup"
        source="ui/checkbox · ui/switch · ui/radio-group"
        layout="stack"
        description="Unchecked, checked, disabled, and aria-invalid."
      >
        <div class="flex flex-wrap items-center gap-4">
          <span class="w-20 text-xs text-muted-foreground">Checkbox</span>
          <Checkbox aria-label="Unchecked" />
          <Checkbox aria-label="Checked" bind:checked={checkboxOn} />
          <Checkbox aria-label="Indeterminate" indeterminate />
          <Checkbox aria-label="Disabled" disabled />
          <Checkbox aria-label="Disabled checked" disabled checked />
          <Checkbox aria-label="Invalid" aria-invalid="true" />
        </div>
        <div class="flex flex-wrap items-center gap-4">
          <span class="w-20 text-xs text-muted-foreground">Switch</span>
          <Switch aria-label="Off" />
          <Switch aria-label="On" bind:checked={switchOn} />
          <Switch aria-label="Disabled" disabled />
          <Switch aria-label="Disabled on" disabled checked />
          <Switch aria-label="Invalid" aria-invalid="true" />
        </div>
        <div class="flex flex-wrap items-center gap-4">
          <span class="w-20 text-xs text-muted-foreground">RadioGroup</span>
          <RadioGroup.Root bind:value={radio} class="flex gap-4">
            <RadioGroup.Item value="a" aria-label="A" />
            <RadioGroup.Item value="b" aria-label="B" />
            <RadioGroup.Item value="c" aria-label="C (disabled)" disabled />
            <RadioGroup.Item
              value="d"
              aria-label="D (invalid)"
              aria-invalid="true"
            />
          </RadioGroup.Root>
        </div>
      </GallerySpecimen>

      <GallerySpecimen
        title="Select"
        source="ui/select"
        layout="stack"
        description="Trigger states, and the content opened in place."
      >
        <div class="flex flex-wrap items-start gap-4">
          <Select.Root type="single" bind:value={selectValue}>
            <Select.Trigger class="w-56">{selectedLabel}</Select.Trigger>
            <Select.Content portalProps={inPlace}>
              {#each models as model (model.value)}
                <Select.Item value={model.value} label={model.label} />
              {/each}
            </Select.Content>
          </Select.Root>
          <Select.Root type="single" disabled>
            <Select.Trigger class="w-56">Disabled</Select.Trigger>
          </Select.Root>
          <Select.Root type="single">
            <Select.Trigger class="w-56" aria-invalid="true"
              >Invalid</Select.Trigger
            >
          </Select.Root>
        </div>
      </GallerySpecimen>
    </GalleryGroup>

    <GalleryGroup
      title="Feedback & status"
      description="Loading, progress, empty, and notification surfaces."
    >
      <GallerySpecimen
        title="Spinner · Progress · Skeleton"
        source="ui/spinner · ui/progress · ui/skeleton"
        layout="stack"
      >
        <div class="flex flex-wrap items-center gap-4">
          <Spinner />
          <Spinner variant="refresh" />
          <Spinner class="size-6 text-primary" />
        </div>
        <div class="flex max-w-md flex-col gap-3">
          <Progress value={0} />
          <Progress value={40} />
          <Progress value={100} />
        </div>
        <div class="flex max-w-md flex-col gap-2">
          <Skeleton class="h-4 w-3/4" />
          <Skeleton class="h-4 w-1/2" />
          <Skeleton class="size-10 rounded-full" />
        </div>
      </GallerySpecimen>

      <GallerySpecimen
        title="Empty"
        source="ui/empty"
        layout="stack"
        description="Media variants default and icon."
      >
        <Empty.Root>
          <Empty.Header>
            <Empty.Media variant="icon"><InboxIcon /></Empty.Media>
            <Empty.Title>No conversations</Empty.Title>
            <Empty.Description
              >Start a conversation to see it here.</Empty.Description
            >
          </Empty.Header>
          <Empty.Content>
            <Button size="sm"><PlusIcon data-icon="inline-start" />New</Button>
          </Empty.Content>
        </Empty.Root>
      </GallerySpecimen>

      <GallerySpecimen
        title="Kbd"
        source="ui/kbd"
        description="Keyboard hint chip."
      >
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
        <Kbd>Ctrl+Shift+P</Kbd>
      </GallerySpecimen>

      <GallerySpecimen
        title="Sonner"
        source="ui/sonner"
        description="Toasts appear at the bottom-right of the window; click to fire one."
      >
        <Button variant="outline" onclick={() => toast("Saved changes")}
          >Default</Button
        >
        <Button
          variant="outline"
          onclick={() =>
            toast.success("Branch pushed", { description: "origin/main" })}
          >Success</Button
        >
        <Button variant="outline" onclick={() => toast.info("Update available")}
          >Info</Button
        >
        <Button
          variant="outline"
          onclick={() => toast.warning("Disk almost full")}>Warning</Button
        >
        <Button variant="outline" onclick={() => toast.error("Push rejected")}
          >Error</Button
        >
        <Button
          variant="outline"
          onclick={() =>
            toast.promise(new Promise((r) => setTimeout(r, 1500)), {
              loading: "Syncing…",
              success: "Synced",
              error: "Failed",
            })}>Loading</Button
        >
      </GallerySpecimen>
    </GalleryGroup>

    <GalleryGroup title="Layout" description="Structural primitives.">
      <GallerySpecimen
        title="Separator"
        source="ui/separator"
        layout="stack"
        description="Horizontal and vertical."
      >
        <div class="flex max-w-sm flex-col gap-2 text-sm">
          <span>Above</span>
          <Separator />
          <span>Below</span>
        </div>
        <div class="flex h-5 items-center gap-3 text-sm">
          <span>One</span>
          <Separator orientation="vertical" />
          <span>Two</span>
          <Separator orientation="vertical" />
          <span>Three</span>
        </div>
      </GallerySpecimen>

      <GallerySpecimen
        title="ScrollArea"
        source="ui/scroll-area"
        layout="stack"
        description="Vertical, horizontal, and both."
      >
        <div class="flex flex-wrap gap-4">
          <ScrollArea class="h-32 w-48 rounded-md border">
            <div class="flex flex-col p-2 text-xs">
              {#each rows as row (row)}<span class="py-1">{row}</span>{/each}
            </div>
          </ScrollArea>
          <ScrollArea
            orientation="horizontal"
            class="h-32 w-48 rounded-md border"
          >
            <div class="flex w-96 gap-2 p-2 text-xs">
              {#each rows as row (row)}<span class="shrink-0">{row}</span
                >{/each}
            </div>
          </ScrollArea>
          <ScrollArea orientation="both" class="h-32 w-48 rounded-md border">
            <div class="w-96 p-2 text-xs">
              {#each rows as row (row)}<p class="py-1">
                  {row} · wide content row
                </p>{/each}
            </div>
          </ScrollArea>
        </div>
      </GallerySpecimen>

      <GallerySpecimen
        title="Resizable"
        source="ui/resizable"
        layout="stack"
        description="Horizontal and vertical pane groups; drag the handle."
      >
        <div class="flex flex-wrap gap-4">
          <div class="h-40 w-80 overflow-hidden rounded-md border">
            <Resizable.PaneGroup direction="horizontal">
              <Resizable.Pane defaultSize={40}>
                <div
                  class="flex h-full items-center justify-center bg-panel text-xs"
                >
                  Pane A
                </div>
              </Resizable.Pane>
              <Resizable.Handle withHandle />
              <Resizable.Pane defaultSize={60}>
                <div
                  class="flex h-full items-center justify-center bg-background text-xs"
                >
                  Pane B
                </div>
              </Resizable.Pane>
            </Resizable.PaneGroup>
          </div>
          <div class="h-40 w-80 overflow-hidden rounded-md border">
            <Resizable.PaneGroup direction="vertical">
              <Resizable.Pane defaultSize={50}>
                <div
                  class="flex h-full items-center justify-center bg-panel text-xs"
                >
                  Top
                </div>
              </Resizable.Pane>
              <Resizable.Handle />
              <Resizable.Pane defaultSize={50}>
                <div
                  class="flex h-full items-center justify-center bg-background text-xs"
                >
                  Bottom
                </div>
              </Resizable.Pane>
            </Resizable.PaneGroup>
          </div>
        </div>
      </GallerySpecimen>

      <GallerySpecimen
        title="Collapsible"
        source="ui/collapsible"
        layout="stack"
      >
        <Collapsible.Root bind:open={collapsed} class="max-w-sm">
          <Collapsible.Trigger>
            {#snippet child({ props })}
              <Button variant="outline" size="sm" {...props}
                >{collapsed ? "Collapse" : "Expand"}</Button
              >
            {/snippet}
          </Collapsible.Trigger>
          <Collapsible.Content class="pt-2 text-sm text-muted-foreground">
            Hidden details revealed by the trigger.
          </Collapsible.Content>
        </Collapsible.Root>
      </GallerySpecimen>
    </GalleryGroup>

    <GalleryGroup
      title="Overlays"
      description="Opened with the buttons and rendered in place inside a clipped frame, so they pick up the surrounding theme."
    >
      <GallerySpecimen
        title="Dialog · AlertDialog · Sheet"
        source="ui/dialog · ui/alert-dialog · ui/sheet"
        layout="stack"
      >
        <div class="flex flex-wrap items-center gap-3">
          <Button variant="outline" onclick={() => (dialogOpen = true)}
            >Dialog</Button
          >
          <Button variant="outline" onclick={() => (alertOpen = true)}
            >AlertDialog</Button
          >
          <Button variant="outline" onclick={() => (sheetOpen = true)}
            >Sheet</Button
          >
        </div>
        <div class="flex gap-3">
          <div class={frameClass}>
            <span class="text-xs text-muted-foreground">Frame</span>
            <Dialog.Root bind:open={dialogOpen}>
              <Dialog.Content portalProps={inPlace} trapFocus={false}>
                <Dialog.Header>
                  <Dialog.Title>Rename conversation</Dialog.Title>
                  <Dialog.Description
                    >Choose a short, descriptive title.</Dialog.Description
                  >
                </Dialog.Header>
                <Input value="Polish the UX" />
                <Dialog.Footer>
                  <Button variant="outline" onclick={() => (dialogOpen = false)}
                    >Cancel</Button
                  >
                  <Button onclick={() => (dialogOpen = false)}>Save</Button>
                </Dialog.Footer>
              </Dialog.Content>
            </Dialog.Root>
            <AlertDialog.Root bind:open={alertOpen}>
              <AlertDialog.Content portalProps={inPlace} trapFocus={false}>
                <AlertDialog.Header>
                  <AlertDialog.Title>Delete conversation?</AlertDialog.Title>
                  <AlertDialog.Description
                    >This cannot be undone.</AlertDialog.Description
                  >
                </AlertDialog.Header>
                <AlertDialog.Footer>
                  <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
                  <AlertDialog.Action>Delete</AlertDialog.Action>
                </AlertDialog.Footer>
              </AlertDialog.Content>
            </AlertDialog.Root>
            <Sheet.Root bind:open={sheetOpen}>
              <Sheet.Content portalProps={inPlace} trapFocus={false}>
                <Sheet.Title class="p-4">Details</Sheet.Title>
                <div class="p-4 pt-0 text-sm text-muted-foreground">
                  Side sheet content.
                  <Button
                    class="mt-3"
                    variant="outline"
                    size="sm"
                    onclick={() => (sheetOpen = false)}>Close</Button
                  >
                </div>
              </Sheet.Content>
            </Sheet.Root>
          </div>
        </div>
      </GallerySpecimen>

      <GallerySpecimen
        title="DropdownMenu · ContextMenu · Tooltip"
        source="ui/dropdown-menu · ui/context-menu · ui/tooltip"
        description="Menus open in place; right-click the target for the context menu."
      >
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Button variant="outline" {...props}>Dropdown</Button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content portalProps={inPlace}>
            <DropdownMenu.Item>Rename</DropdownMenu.Item>
            <DropdownMenu.CheckboxItem bind:checked={menuChecked}
              >Pinned</DropdownMenu.CheckboxItem
            >
            <DropdownMenu.Separator />
            <DropdownMenu.Item disabled>Disabled</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        <ContextMenu.Root>
          <ContextMenu.Trigger
            class="flex h-control items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground"
          >
            Right-click here
          </ContextMenu.Trigger>
          <ContextMenu.Content portalProps={inPlace}>
            <ContextMenu.Item
              >Open <ContextMenu.Shortcut>⏎</ContextMenu.Shortcut
              ></ContextMenu.Item
            >
            <ContextMenu.CheckboxItem bind:checked={menuChecked}
              >Pinned</ContextMenu.CheckboxItem
            >
            <ContextMenu.RadioGroup bind:value={menuRadio}>
              <ContextMenu.RadioItem value="a">Option A</ContextMenu.RadioItem>
              <ContextMenu.RadioItem value="b">Option B</ContextMenu.RadioItem>
            </ContextMenu.RadioGroup>
            <ContextMenu.Separator />
            <ContextMenu.Item variant="destructive">Delete</ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Root>

        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button variant="outline" {...props}>Hover for tooltip</Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content portalProps={inPlace}>
            Copy path <Kbd>⌘C</Kbd>
          </Tooltip.Content>
        </Tooltip.Root>
      </GallerySpecimen>
    </GalleryGroup>
  </div>
</Tooltip.Provider>
