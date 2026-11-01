<script lang="ts">
import SettingsNav from "$lib/presentation/settings/SettingsNav.svelte";
import SettingsChangeIndicator from "$lib/presentation/settings/SettingsChangeIndicator.svelte";
import EntityCard from "$lib/presentation/settings/EntityCard.svelte";
import EntityRow from "$lib/presentation/settings/EntityRow.svelte";
import BrainIcon from "@lucide/svelte/icons/brain";
import CpuIcon from "@lucide/svelte/icons/cpu";
import FolderIcon from "@lucide/svelte/icons/folder";
import KeyRoundIcon from "@lucide/svelte/icons/key-round";
import KeyboardIcon from "@lucide/svelte/icons/keyboard";
import MonitorIcon from "@lucide/svelte/icons/monitor";
import PencilIcon from "@lucide/svelte/icons/pencil";
import PlusIcon from "@lucide/svelte/icons/plus";
import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
import ServerIcon from "@lucide/svelte/icons/server";
import SlidersHorizontalIcon from "@lucide/svelte/icons/sliders-horizontal";
import StarIcon from "@lucide/svelte/icons/star";
import Trash2Icon from "@lucide/svelte/icons/trash-2";
import WrenchIcon from "@lucide/svelte/icons/wrench";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import {
  SettingsDisclosureItem,
  SettingsEmptyState,
  SettingsFieldRow,
  SettingsInfoHint,
  SettingsList,
  SettingsListItem,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsSelectRow,
  SettingsShell,
  SettingsSidebarStatus,
  SettingsStatGrid,
  SettingsToggleRow,
  SettingsToolbar,
  type SettingsPageDef,
  type SettingsStat,
} from "$lib/presentation/settings";
import ThemePreviewPicker from "$lib/features/settings/views/pages/workbench/ThemePreviewPicker.svelte";
import { defaultColorTheme } from "@nervekit/contracts/settings";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";

const saveStatuses = ["idle", "dirty", "saving", "saved", "error"] as const;
const saveText: Record<(typeof saveStatuses)[number], string> = {
  idle: "No changes",
  dirty: "Unsaved changes",
  saving: "Saving…",
  saved: "Auto save enabled",
  error: "Could not save settings",
};

const longText =
  "/home/someone/Projects/a-monorepo-with-a-very-long-name/packages/workbench-app/src/lib/presentation/settings";

const headerStyles = [
  { value: "auto", label: "Auto" },
  { value: "custom", label: "Custom" },
  { value: "native", label: "Native" },
];

const stats: SettingsStat[] = [
  { label: "Platform", value: "linux" },
  { label: "Daemon mode", value: "owned" },
  { label: "Web assets", value: "bundled/default" },
  { label: "Proxy", value: "not configured" },
  { label: "Data directory", value: longText, wide: true, mono: true },
];

let toggleA = $state(true);
let toggleB = $state(false);
let selectValue = $state("auto");
let fieldText = $state("127.0.0.1");
let fieldNumber = $state("43967");
// Local only: picking a card here never changes the lab or app theme.
let theme = $state<string>(defaultColorTheme);
let specimenTheme = $state("melange-light");
let discA = $state(false);
let discB = $state(true);

// ── In context: SettingsShell (screenshots 29 Workbench, 34 Tools) ────────
const pages: SettingsPageDef[] = [
  {
    id: "workbench",
    label: "Workbench",
    icon: MonitorIcon,
    sections: [
      { id: "appearance", label: "Appearance" },
      { id: "desktop", label: "Desktop" },
    ],
  },
  {
    id: "providers",
    label: "Providers",
    icon: KeyRoundIcon,
    sections: [{ id: "subscriptions", label: "Subscriptions" }],
  },
  { id: "models", label: "Models", icon: BrainIcon, sections: [] },
  {
    id: "compaction",
    label: "Compaction",
    icon: SlidersHorizontalIcon,
    sections: [],
  },
  {
    id: "tools",
    label: "Tools",
    icon: WrenchIcon,
    sections: [
      { id: "core", label: "Core" },
      { id: "third-party", label: "Third party" },
    ],
  },
  { id: "shortcuts", label: "Shortcuts", icon: KeyboardIcon, sections: [] },
];
const groups = [
  {
    id: "pages",
    title: "Pages",
    items: pages.map(({ id, label, icon }) => ({ id, label, icon })),
  },
];
const coreTools = [
  {
    id: "inspect",
    title: "File inspection",
    description:
      "Read, list, find, and search workspace files without modifying them.",
    on: true,
    configure: false,
  },
  {
    id: "edit",
    title: "File editing",
    description:
      "Create and modify workspace files when the agent policy permits writes.",
    on: true,
    configure: false,
  },
  {
    id: "shell",
    title: "Shell",
    description:
      "Run finite shell commands for checks, tests, builds, and project maintenance.",
    on: true,
    configure: true,
  },
  {
    id: "python",
    title: "Python",
    description:
      "Run short Python scripts or files for data processing and analysis.",
    on: true,
    configure: true,
  },
  {
    id: "todos",
    title: "Todos",
    description: "Track multi-step work with a lightweight checklist.",
    on: true,
    configure: false,
  },
];
const thirdPartyTools = [
  {
    id: "web",
    title: "Web access",
    description: "Search the web and fetch URLs for external context.",
    on: true,
  },
  {
    id: "vision",
    title: "Image explanation",
    description:
      "Use a separate vision model to explain images to text-only models.",
    on: false,
  },
  {
    id: "imagegen",
    title: "Image generation",
    description: "Generate images through the provider configured in Settings.",
    on: false,
  },
];
let toolState = $state<Record<string, boolean>>({
  inspect: true,
  edit: true,
  shell: true,
  python: true,
  todos: true,
  web: true,
  vision: false,
  imagegen: false,
});
let activePageId = $state("workbench");
let activeSectionId = $state("appearance");
let trayToggle = $state(false);
let headerStyle = $state("auto");
</script>

<div class="flex flex-col gap-10">
  <GalleryGroup
    title="In context"
    description="The real SettingsShell at ~1000×640 (the settings tab): sidebar nav with User/Project scope and save status, Workbench page and Tools page built from the primitives below. Switch pages in the sidebar."
  >
    <GallerySpecimen
      title="SettingsShell — Workbench / Tools"
      source="settings/SettingsShell"
      usage="1 file · shell"
      layout="bare"
    >
      <div class="h-160 w-250 max-w-full overflow-hidden rounded-md border">
        <SettingsShell {pages} {groups} bind:activePageId bind:activeSectionId>
          {#snippet sidebarFooter()}
            <SettingsSidebarStatus status="saved" text={saveText.saved} />
          {/snippet}
          {#snippet children(page)}
            {#if page.id === "workbench"}
              <SettingsSection id="appearance" title="Appearance">
                <SettingsRow label="Theme" layout="stacked">
                  <ThemePreviewPicker bind:value={theme} />
                </SettingsRow>
              </SettingsSection>
              <SettingsSection id="desktop" title="Desktop">
                <SettingsSelectRow
                  label="Header style"
                  description="Auto follows your operating system. Choose another style to override it."
                >
                  {#snippet control(disabled)}
                    <SelectField
                      items={headerStyles}
                      bind:value={headerStyle}
                      {disabled}
                      ariaLabel="Header style"
                    />
                  {/snippet}
                </SettingsSelectRow>
                <SettingsToggleRow
                  label="Close to system tray"
                  description="Hide Nerve in the tray instead of quitting."
                  bind:checked={trayToggle}
                />
              </SettingsSection>
            {:else if page.id === "tools"}
              <SettingsSection id="core" title="Core">
                <SettingsList ariaLabel="Core tool groups">
                  {#each coreTools as tool (tool.id)}
                    <SettingsDisclosureItem
                      title={tool.title}
                      description={tool.description}
                    >
                      {#snippet actions()}
                        {#if tool.configure}
                          <Button variant="outline" size="sm">
                            <SlidersHorizontalIcon data-icon="inline-start" />
                            Configure
                          </Button>
                        {/if}
                        <Switch
                          bind:checked={toolState[tool.id]}
                          aria-label={tool.title}
                        />
                      {/snippet}
                      {#snippet detail()}
                        <span class="font-mono text-foreground">{tool.id}</span>
                      {/snippet}
                    </SettingsDisclosureItem>
                  {/each}
                  <SettingsListItem
                    title="Sub-agents"
                    description="Delegate work to sub-agents with their own profiles. Profiles, models and permissions are configured on the Sub-agents page."
                  >
                    {#snippet actions()}
                      <Button variant="outline" size="sm"
                        >Open Sub-agents</Button
                      >
                    {/snippet}
                  </SettingsListItem>
                </SettingsList>
              </SettingsSection>
              <SettingsSection id="third-party" title="Third party">
                <SettingsList ariaLabel="Third-party tool groups">
                  {#each thirdPartyTools as tool (tool.id)}
                    <SettingsDisclosureItem
                      title={tool.title}
                      description={tool.description}
                    >
                      {#snippet actions()}
                        <Button variant="outline" size="sm">
                          <SlidersHorizontalIcon data-icon="inline-start" />
                          Configure
                        </Button>
                        <Switch
                          bind:checked={toolState[tool.id]}
                          aria-label={tool.title}
                        />
                      {/snippet}
                      {#snippet detail()}
                        <span class="font-mono text-foreground">{tool.id}</span>
                      {/snippet}
                    </SettingsDisclosureItem>
                  {/each}
                </SettingsList>
              </SettingsSection>
            {:else}
              <SettingsSection id={page.id} title={page.label}>
                <SettingsEmptyState
                  variant="card"
                  icon={CpuIcon}
                  title="Not modelled in the gallery"
                  description="Pick Workbench or Tools."
                />
              </SettingsSection>
            {/if}
          {/snippet}
        </SettingsShell>
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Headings"
    description="Page title text-title semibold, section heading text-ui semibold, group heading text-ui semibold muted."
  >
    <GallerySpecimen
      title="SettingsPageHeader"
      source="settings/SettingsPageHeader"
      usage="1 file · settings (via SettingsShell)"
      layout="stack"
    >
      <SettingsPageHeader
        title="Skills"
        description="Reusable instructions that agents can load on demand."
      >
        {#snippet actions()}
          <Button variant="outline">
            <RefreshCwIcon data-icon="inline-start" />
            Reload
          </Button>
        {/snippet}
      </SettingsPageHeader>
    </GallerySpecimen>

    <GallerySpecimen
      title="SettingsSection"
      source="settings/SettingsSection"
      usage="11 files · settings"
      layout="stack"
      description="Heading with optional info hint and actions; body is a grid."
    >
      <SettingsSection
        id="gallery-section"
        title="Network"
        info="Detail lives in a tooltip beside the title."
      >
        {#snippet actions()}
          <Button variant="outline" size="sm">
            <PlusIcon data-icon="inline-start" />
            Add
          </Button>
        {/snippet}
        <SettingsToggleRow label="Example row" bind:checked={toggleA} />
      </SettingsSection>
    </GallerySpecimen>

    <GallerySpecimen
      title="SettingsInfoHint"
      source="settings/SettingsInfoHint"
      usage="2 files · settings"
      description="Hover or focus the info icon."
    >
      <span class="flex items-center gap-1.5 text-ui font-medium">
        Hint <SettingsInfoHint text="Brief explanation." />
      </span>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Rows"
    description="Row title text-ui regular foreground; supporting text text-ui muted."
  >
    <GallerySpecimen
      title="SettingsRow"
      source="settings/SettingsRow"
      usage="6 files · settings, dialogs"
      layout="stack"
      description="Label + description with a control slot. Layouts: inline (default), stacked and responsive."
    >
      <SettingsRow
        label="Clean up conversations"
        description="Remove conversations by age or keep only the most recent."
      >
        {#snippet control()}
          <Button variant="outline">Configure</Button>
        {/snippet}
      </SettingsRow>
      <SettingsRow
        label="Compaction profile"
        description="Thresholds scale with the selected model's context window."
        layout="stacked"
      >
        <div
          class="rounded-md border bg-card px-3 py-2 text-ui text-muted-foreground"
        >
          Children slot content
        </div>
      </SettingsRow>
    </GallerySpecimen>

    <GallerySpecimen
      title="SettingsToggleRow"
      source="settings/SettingsToggleRow"
      usage="7 files · settings, dialogs"
      layout="stack"
      description="Row + settings-size Switch."
    >
      <SettingsToggleRow
        label="System notifications"
        description="Supporting text explains the effect."
        bind:checked={toggleA}
      />
      <SettingsToggleRow label="Unchecked" bind:checked={toggleB} />
      <SettingsToggleRow
        label="Disabled"
        description="Cannot be changed"
        checked
        disabled
      />
    </GallerySpecimen>

    <GallerySpecimen
      title="SettingsSelectRow"
      source="settings/SettingsSelectRow"
      usage="3 files · settings"
      layout="stack"
      description="Row with a fixed control column; the control snippet receives the disabled flag."
    >
      <SettingsSelectRow
        label="Header style"
        description="Auto follows your operating system."
      >
        {#snippet control(disabled)}
          <SelectField
            items={headerStyles}
            bind:value={selectValue}
            {disabled}
            ariaLabel="Header style"
          />
        {/snippet}
      </SettingsSelectRow>
      <SettingsSelectRow label="Ozone platform" disabled>
        {#snippet control(disabled)}
          <SelectField
            items={headerStyles}
            value="custom"
            {disabled}
            ariaLabel="Disabled"
          />
        {/snippet}
      </SettingsSelectRow>
    </GallerySpecimen>

    <GallerySpecimen
      title="SettingsFieldRow"
      source="settings/SettingsFieldRow"
      usage="2 files · settings"
      layout="stack"
      description="Stacked label + Input with optional suffix and hint."
    >
      <div class="grid items-start gap-4 md:grid-cols-2">
        <SettingsFieldRow
          id="gallery-field-text"
          label="Bind host"
          bind:value={fieldText}
        />
        <SettingsFieldRow
          id="gallery-field-number"
          label="HTTP port"
          type="number"
          suffix="port"
          min={1}
          max={65535}
          bind:value={fieldNumber}
          hint="Restart required after changing."
        />
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Lists"
    description="Entity lists are one bordered SettingsList of hairline-divided rows. Right column holds IconActions."
  >
    <GallerySpecimen
      title="SettingsList + SettingsListItem"
      source="settings/SettingsList"
      usage="9 files · settings, shell"
      layout="stack"
      description="title → detail → status badges → description. Includes a disabled-action row and a long-text row."
    >
      <SettingsList ariaLabel="Providers">
        <SettingsListItem
          title="Anthropic"
          description="Claude models via the Messages API"
        >
          {#snippet detail()}
            api.anthropic.com
          {/snippet}
          {#snippet status()}
            <Badge variant="success">Connected</Badge>
            <Badge variant="neutral">Default</Badge>
          {/snippet}
          {#snippet actions()}
            <IconAction icon={StarIcon} label="Make default" active />
            <IconAction icon={PencilIcon} label="Edit" />
            <IconAction icon={Trash2Icon} label="Delete" tone="destructive" />
          {/snippet}
        </SettingsListItem>
        <SettingsListItem
          title="OpenAI-compatible"
          description="Self-hosted endpoint"
        >
          {#snippet leading()}
            <ServerIcon
              class="size-4 flex-none text-muted-foreground"
              aria-hidden="true"
            />
          {/snippet}
          {#snippet status()}
            <Badge variant="warning">Needs key</Badge>
          {/snippet}
          {#snippet actions()}
            <IconAction icon={KeyRoundIcon} label="Add API key" />
            <IconAction icon={RefreshCwIcon} label="Refresh models" busy />
            <IconAction
              icon={Trash2Icon}
              label="Delete"
              tone="destructive"
              disabled
            />
          {/snippet}
        </SettingsListItem>
        <SettingsListItem title={longText} description={longText}>
          {#snippet actions()}
            <IconAction icon={PencilIcon} label="Edit" />
          {/snippet}
        </SettingsListItem>
      </SettingsList>
    </GallerySpecimen>

    <GallerySpecimen
      title="SettingsDisclosureItem"
      source="settings/SettingsDisclosureItem"
      usage="4 files · settings, shell"
      layout="stack"
      description="Expandable list row (plain variant, as used by Tools and Skills): chevron rotates, description unclamps when open."
    >
      <SettingsList ariaLabel="Disclosures">
        <SettingsDisclosureItem
          title="Closed"
          description="A long description that is clamped to a single line while the item is collapsed and expands in place when it is opened by the user."
          bind:open={discA}
        >
          {#snippet badges()}
            <Badge variant="success">Enabled</Badge>
          {/snippet}
          {#snippet actions()}
            <IconAction icon={PencilIcon} label="Edit" />
          {/snippet}
          {#snippet detail()}
            <span class="font-mono">{longText}</span>
          {/snippet}
        </SettingsDisclosureItem>
        <SettingsDisclosureItem
          title="Open"
          description="Description unclamps when open."
          bind:open={discB}
        >
          {#snippet leading()}
            <FolderIcon
              class="size-4 flex-none text-muted-foreground"
              aria-hidden="true"
            />
          {/snippet}
          {#snippet detail()}
            <span
              >Supplemental content only — paths, nested lists or controls.</span
            >
          {/snippet}
        </SettingsDisclosureItem>
      </SettingsList>
    </GallerySpecimen>

    <GallerySpecimen
      title="SettingsEmptyState"
      source="settings/SettingsEmptyState"
      usage="7 files · settings, shell"
      layout="stack"
      description="Dashed card variant (the one used in 6 of 9 sites) and the plain inline form."
    >
      <div class="grid gap-4 md:grid-cols-2">
        <SettingsEmptyState title="No matching skills" />
        <SettingsEmptyState
          variant="card"
          title="No project-specific profiles yet"
          description="Select a project to configure overrides."
          icon={CpuIcon}
        />
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup title="Choice & preview">
    <GallerySpecimen
      title="SettingsPreviewCards"
      source="settings/SettingsPreviewCards"
      usage="1 file · settings"
      layout="stack"
      description="Equal-width swatch cards; the theme picker renders each theme from data-theme-preview. Arrow keys move the selection."
    >
      <ThemePreviewPicker bind:value={specimenTheme} />
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup title="Feedback & status">
    <GallerySpecimen
      title="SettingsStatGrid"
      source="settings/SettingsStatGrid"
      usage="1 file · settings"
      layout="stack"
      description="Stat tiles, 2 columns from md; `wide` spans both, `mono` for paths and ids."
    >
      <SettingsStatGrid items={stats} />
    </GallerySpecimen>

    <GallerySpecimen
      title="SettingsToolbar"
      source="settings/SettingsToolbar"
      usage="4 files · settings, shell"
      layout="stack"
      description="Start / end slots that wrap on narrow widths."
    >
      <SettingsToolbar>
        {#snippet start()}
          <span class="text-ui text-muted-foreground">3 providers</span>
        {/snippet}
        {#snippet end()}
          <Button variant="outline">
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
          <Button>
            <PlusIcon data-icon="inline-start" />
            Add
          </Button>
        {/snippet}
      </SettingsToolbar>
    </GallerySpecimen>

    <GallerySpecimen
      title="SettingsSidebarStatus"
      source="settings/SettingsSidebarStatus"
      usage="1 file · shell"
      surface="panel"
      layout="stack"
      description="Save-state footer used in the settings sidebar (13.5rem wide)."
    >
      <div class="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {#each saveStatuses as status (status)}
          <div class="w-54 max-w-full">
            <SettingsSidebarStatus {status} text={saveText[status]} />
          </div>
        {/each}
      </div>
    </GallerySpecimen>
  </GalleryGroup>
  <GalleryGroup title="Shared presentation">
    <GallerySpecimen
      title="SettingsNav"
      source="presentation/settings/SettingsNav.svelte"
      layout="stack"
    >
      <SettingsNav
        groups={[
          {
            id: "general",
            title: "General",
            items: [
              { id: "appearance", label: "Appearance", icon: MonitorIcon },
            ],
          },
          {
            id: "agent",
            title: "Agent",
            items: [
              {
                id: "providers",
                label: "Providers",
                icon: KeyRoundIcon,
                badge: { text: "2", tone: "info" },
              },
            ],
          },
          {
            id: "project",
            title: "Project",
            items: [
              {
                id: "advanced",
                label: "Advanced",
                icon: WrenchIcon,
                disabled: true,
              },
            ],
          },
        ]}
        activeId="appearance"
        header={{ title: "User settings" }}
        onSelect={() => {}}
      />
    </GallerySpecimen>
    <GallerySpecimen
      title="SettingsChangeIndicator"
      source="presentation/settings/SettingsChangeIndicator.svelte"
      layout="stack"
    >
      <SettingsChangeIndicator
        scope="user"
        from="Balanced"
        to="Early"
        onReset={() => {}}
      />
      <SettingsChangeIndicator
        scope="project"
        from="Claude Sonnet 4"
        to="GPT-5"
        compact
        onReset={() => {}}
      />
    </GallerySpecimen>
    <GallerySpecimen
      title="EntityCard"
      source="presentation/settings/EntityCard.svelte"
      layout="stack"
    >
      <EntityCard
        title="Planning"
        description="Read-only exploration before implementation."
        ><EntityRow
          label="Model"
          value="Claude Sonnet 4"
          onEdit={() => {}}
        /></EntityCard
      >
    </GallerySpecimen>
    <GallerySpecimen
      title="EntityRow"
      source="presentation/settings/EntityRow.svelte"
      layout="stack"
    >
      <EntityRow
        label="Reasoning"
        value="High"
        onEdit={() => {}}
        onRemove={() => {}}
      />
      <EntityRow label="Permissions" value="Read-only" />
    </GallerySpecimen>
  </GalleryGroup>
</div>
