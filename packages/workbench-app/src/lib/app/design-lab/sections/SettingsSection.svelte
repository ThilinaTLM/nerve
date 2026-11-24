<script lang="ts">
import type { PageStat } from "@nervekit/ui-kit/components/composites/page";
import {
  FieldRow,
  PageEmptyState,
  PageHeader,
  PageItem,
  PageList,
  PageStatGrid,
  ToggleRow,
} from "@nervekit/ui-kit/components/composites/page";
import SettingsNav from "$lib/presentation/settings/SettingsNav.svelte";
import SettingsChangeIndicator from "$lib/presentation/settings/SettingsChangeIndicator.svelte";
import EntityCard from "$lib/presentation/settings/EntityCard.svelte";
import EntityRow from "$lib/presentation/settings/EntityRow.svelte";
import OAuthInteractionPanel from "$lib/presentation/settings/OAuthInteractionPanel.svelte";
import ColumnLabels from "$lib/presentation/settings/ColumnLabels.svelte";
import LayerCells from "$lib/presentation/settings/LayerCells.svelte";
import LayerEnabledTable from "$lib/presentation/settings/LayerEnabledTable.svelte";
import LayerRow from "$lib/presentation/settings/LayerRow.svelte";
import LayerSwitches from "$lib/presentation/settings/LayerSwitches.svelte";
import LevelMenu from "$lib/presentation/settings/LevelMenu.svelte";
import OriginGroup from "$lib/presentation/settings/OriginGroup.svelte";
import ProjectColumnsToggle from "$lib/presentation/settings/ProjectColumnsToggle.svelte";
import ProjectOverrideMark from "$lib/presentation/settings/ProjectOverrideMark.svelte";
import SplitColumns from "$lib/presentation/settings/SplitColumns.svelte";
import TipBadge from "$lib/presentation/settings/TipBadge.svelte";
import type { OAuthFlowInfo } from "@nervekit/contracts/auth";
import BrainIcon from "@lucide/svelte/icons/brain";
import CpuIcon from "@lucide/svelte/icons/cpu";
import KeyRoundIcon from "@lucide/svelte/icons/key-round";
import KeyboardIcon from "@lucide/svelte/icons/keyboard";
import MonitorIcon from "@lucide/svelte/icons/monitor";
import PlusIcon from "@lucide/svelte/icons/plus";
import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
import SlidersHorizontalIcon from "@lucide/svelte/icons/sliders-horizontal";
import Trash2Icon from "@lucide/svelte/icons/trash-2";
import WrenchIcon from "@lucide/svelte/icons/wrench";
import BookOpenIcon from "@lucide/svelte/icons/book-open";
import CodeIcon from "@lucide/svelte/icons/code";
import EyeIcon from "@lucide/svelte/icons/eye";
import ImageIcon from "@lucide/svelte/icons/image";
import PlugZapIcon from "@lucide/svelte/icons/plug-zap";
import TerminalIcon from "@lucide/svelte/icons/terminal";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import {
  RestartNeededCallout,
  SettingsFieldRow,
  SettingsInfoHint,
  SettingsSection,
  SettingsSelectRow,
  SettingsShell,
  SettingsSidebarStatus,
  SettingsToolbar,
  type SettingsPageDef,
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

const stats: PageStat[] = [
  { label: "Platform", value: "linux" },
  { label: "Daemon mode", value: "owned" },
  { label: "Web assets", value: "bundled/default" },
  { label: "Proxy", value: "not configured" },
  { label: "Data directory", value: longText, wide: true, mono: true },
];

const layerProject = "TestApp";
const layered = $state({
  core: { user: true, project: undefined as boolean | undefined },
  docs: { user: false, project: true as boolean | undefined },
  local: { user: true, project: undefined as boolean | undefined },
});
let layerModelUser = $state("auto");
let layerModelProject = $state("auto");
let columnsShown = $state(false);

let toggleA = $state(true);
let toggleB = $state(false);
let selectValue = $state("auto");
let fieldText = $state("127.0.0.1");
let fieldNumber = $state("43967");
// Local only: picking a card here never changes the lab or app theme.
let theme = $state<string>(defaultColorTheme);
let specimenTheme = $state("melange-light");
let itemPython = $state(false);
let itemImage = $state(true);
let itemSkill = $state(true);

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
    id: "images",
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
  web: true,
  vision: false,
  images: false,
});
let activePageId = $state("workbench");
let activeSectionId = $state("appearance");
let trayToggle = $state(false);
let headerStyle = $state("auto");
const deviceCodeFlow: OAuthFlowInfo = {
  flowId: "authflow_specimen",
  provider: "account:work-github",
  providerName: "Work GitHub",
  account: { kind: "github", id: "work-github" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  state: "active",
  interaction: {
    type: "device_code",
    verificationUrl: "https://github.com/login/device",
    userCode: "WDJB-MJHT",
  },
};
let oauthResponse = $state("");
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
                <FieldRow label="Theme" layout="stacked">
                  <ThemePreviewPicker bind:value={theme} />
                </FieldRow>
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
                <ToggleRow
                  label="Close to system tray"
                  description="Hide Nerve in the tray instead of quitting."
                  bind:checked={trayToggle}
                />
              </SettingsSection>
            {:else if page.id === "tools"}
              <SettingsSection id="core" title="Core">
                <PageList ariaLabel="Core tool groups">
                  {#each coreTools as tool (tool.id)}
                    <PageItem
                      icon={WrenchIcon}
                      title={tool.title}
                      summary={tool.description}
                      bind:checked={toolState[tool.id]}
                      onOpen={tool.configure ? () => {} : undefined}
                    />
                  {/each}
                  <PageItem
                    icon={CpuIcon}
                    title="Sub-agents"
                    summary="Profiles, models and permissions are on the Sub-agents page."
                    onOpen={() => {}}
                    openLabel="Open Sub-agents"
                  />
                </PageList>
              </SettingsSection>
              <SettingsSection id="third-party" title="Third party">
                <PageList ariaLabel="Third-party tool groups">
                  {#each thirdPartyTools as tool (tool.id)}
                    <PageItem
                      icon={WrenchIcon}
                      title={tool.title}
                      summary={tool.description}
                      bind:checked={toolState[tool.id]}
                      onOpen={() => {}}
                    />
                  {/each}
                </PageList>
              </SettingsSection>
            {:else}
              <SettingsSection id={page.id} title={page.label}>
                <PageEmptyState
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
      title="PageHeader"
      source="settings/PageHeader"
      usage="1 file · settings (via SettingsShell)"
      layout="stack"
    >
      <PageHeader
        title="Skills"
        description="Reusable instructions that agents can load on demand."
      >
        {#snippet actions()}
          <Button variant="outline">
            <RefreshCwIcon data-icon="inline-start" />
            Reload
          </Button>
        {/snippet}
      </PageHeader>
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
        <ToggleRow label="Example row" bind:checked={toggleA} />
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
      title="FieldRow"
      source="settings/FieldRow"
      usage="6 files · settings, dialogs"
      layout="stack"
      description="Label + description with a control slot. Layouts: inline (default), stacked and responsive."
    >
      <FieldRow
        label="Clean up conversations"
        description="Remove conversations by age or keep only the most recent."
      >
        {#snippet control()}
          <Button variant="outline">Configure</Button>
        {/snippet}
      </FieldRow>
      <FieldRow
        label="Compaction profile"
        description="Thresholds scale with the selected model's context window."
        layout="stacked"
      >
        <div
          class="rounded-md border bg-card px-3 py-2 text-ui text-muted-foreground"
        >
          Children slot content
        </div>
      </FieldRow>
    </GallerySpecimen>

    <GallerySpecimen
      title="ToggleRow"
      source="settings/ToggleRow"
      usage="7 files · settings, dialogs"
      layout="stack"
      description="Row + settings-size Switch."
    >
      <ToggleRow
        label="System notifications"
        description="Supporting text explains the effect."
        bind:checked={toggleA}
      />
      <ToggleRow label="Unchecked" bind:checked={toggleB} />
      <ToggleRow
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
      title="RestartNeededCallout"
      source="settings/RestartNeededCallout"
      usage="2 files · settings"
      layout="stack"
      description="Saved application settings that wait for a restart, with the daemon restart action."
    >
      <RestartNeededCallout daemon desktop={false} canRestart />
      <RestartNeededCallout daemon desktop canRestart restarting />
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
    description="Entity lists are one bordered PageList of hairline-divided rows. Right column holds IconActions."
  >
    <GallerySpecimen
      title="PageList + PageItem"
      source="settings/PageItem"
      usage="settings catalogs and entity lists"
      layout="stack"
      description="Catalog row: identity icon, exceptional badges, one status line (a problem replaces the summary), meta, switch, chevron. The whole row opens the item."
    >
      <PageList ariaLabel="Catalog items">
        <PageItem
          icon={TerminalIcon}
          title="Bash"
          summary="Auto-background after 30 s"
          always
          onOpen={() => {}}
        />
        <PageItem
          icon={CodeIcon}
          title="Python"
          summary="Python 3.13 (uv)"
          bind:checked={itemPython}
          onOpen={() => {}}
        >
          {#snippet meta()}
            <SettingsChangeIndicator
              scope="project"
              from="On"
              onReset={() => {}}
            />
          {/snippet}
        </PageItem>
        <PageItem
          icon={ImageIcon}
          title="Image generation"
          summary="OpenAI · gpt-image"
          problem="Sign in to OpenAI in Providers"
          problemAction={{ label: "Sign in", onclick: () => {} }}
          bind:checked={itemImage}
          onOpen={() => {}}
        >
          {#snippet badges()}<Badge variant="info">Experimental</Badge
            >{/snippet}
        </PageItem>
        <PageItem
          icon={EyeIcon}
          title="Image explanation"
          summary="gpt-5.2-mini"
          checked
          lockedBy="Planning"
          onOpen={() => {}}
        />
        <PageItem
          icon={BookOpenIcon}
          title="engineering-docs"
          summary={longText}
          mono
          bind:checked={itemSkill}
        />
        <PageItem
          icon={KeyRoundIcon}
          title="acme-cloud"
          summary="acme.example.com · used by you and 2 projects"
          onOpen={() => {}}
        >
          {#snippet actions()}
            <IconAction icon={PlugZapIcon} label="Test connection" />
            <IconAction icon={Trash2Icon} label="Delete" tone="destructive" />
          {/snippet}
        </PageItem>
      </PageList>
    </GallerySpecimen>

    <GallerySpecimen
      title="PageItem (compact)"
      source="settings/PageItem"
      usage="shortcuts"
      layout="stack"
      description="compact: single-line rows (min-h-10, no status line) for reference lists whose rows never have a second line."
    >
      <PageList ariaLabel="Compact rows">
        {#each ["New conversation", "Open command palette", "Toggle sidebar"] as label, i (label)}
          <PageItem compact title={label}>
            {#snippet meta()}
              <span
                class="whitespace-nowrap font-mono text-caption text-muted-foreground"
                >{["Ctrl+N", "Ctrl+K", "Ctrl+B"][i]}</span
              >
            {/snippet}
          </PageItem>
        {/each}
      </PageList>
    </GallerySpecimen>

    <GallerySpecimen
      title="PageEmptyState"
      source="settings/PageEmptyState"
      usage="7 files · settings, shell"
      layout="stack"
      description="Dashed card variant (the one used in 6 of 9 sites) and the plain inline form."
    >
      <div class="grid gap-4 md:grid-cols-2">
        <PageEmptyState title="No matching skills" />
        <PageEmptyState
          variant="card"
          title="No project-specific profiles yet"
          description="Select a project to configure overrides."
          icon={CpuIcon}
        />
        <SettingsSection title="In a divided section" divided>
          <PageEmptyState
            variant="card"
            icon={CpuIcon}
            title="Pads like a row"
            description="A divided surface has no padding, so the empty state supplies it."
          />
        </SettingsSection>
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
      title="PageStatGrid"
      source="settings/PageStatGrid"
      usage="1 file · settings"
      layout="stack"
      description="Stat tiles, 2 columns from md; `wide` spans both, `mono` for paths and ids."
    >
      <PageStatGrid items={stats} />
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
        onReset={() => {}}
      />
      <SettingsChangeIndicator
        scope="project"
        from="Claude Sonnet 4"
        onReset={() => {}}
      />
    </GallerySpecimen>
    <GallerySpecimen
      title="OAuthInteractionPanel"
      source="presentation/settings/OAuthInteractionPanel.svelte"
      layout="stack"
    >
      <OAuthInteractionPanel
        flow={deviceCodeFlow}
        busy={false}
        bind:responseValue={oauthResponse}
        copiedLoginUrl={false}
        copiedDeviceCode={false}
        deviceCodeSecondsRemaining={540}
        onSelect={() => {}}
        onSubmit={() => {}}
        onCopyLoginUrl={() => {}}
        onCopyDeviceCode={() => {}}
        onOpen={() => {}}
        onRetry={() => {}}
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

  <GalleryGroup
    title="Layers and origin groups"
    description="User and project columns on the unified settings lists."
  >
    <GallerySpecimen
      title="OriginGroup + LayerSwitches + TipBadge"
      source="presentation/settings/OriginGroup.svelte"
      layout="stack"
    >
      <p class="text-caption text-muted-foreground">
        The column labels are quiet text on the group's caption line. A
        project-only group shows none: its caption names the project.
      </p>
      <OriginGroup
        origin={{ kind: "project" }}
        count={1}
        projectName={layerProject}
      >
        <PageItem
          icon={BookOpenIcon}
          title="local-conventions"
          summary="Project skill"
        >
          {#snippet meta()}
            <LayerSwitches
              name="local-conventions"
              user={layered.local.user}
              project={layered.local.project ?? layered.local.user}
              projectSet={layered.local.project !== undefined}
              projectName={layerProject}
              projectOnly
              onChange={(_, value) => (layered.local.project = value)}
            />
          {/snippet}
        </PageItem>
      </OriginGroup>
      <OriginGroup
        origin={{ kind: "builtin" }}
        count={2}
        projectName={layerProject}
      >
        <PageItem icon={WrenchIcon} title="core" summary="Built-in skill">
          {#snippet badges()}
            <TipBadge
              text="Default"
              variant="brand"
              tip="Used when nothing else is chosen."
            />
          {/snippet}
          {#snippet meta()}
            <LayerSwitches
              name="core"
              user={layered.core.user}
              project={layered.core.project ?? layered.core.user}
              projectSet={layered.core.project !== undefined}
              projectName={layerProject}
              onChange={(layer, value) =>
                layer === "user"
                  ? (layered.core.user = value)
                  : (layered.core.project =
                      value === layered.core.user ? undefined : value)}
            />
          {/snippet}
        </PageItem>
        <PageItem
          icon={BookOpenIcon}
          title="engineering-docs"
          summary="Off for User, on in the project"
        >
          {#snippet meta()}
            <LayerSwitches
              name="engineering-docs"
              user={layered.docs.user}
              project={layered.docs.project ?? layered.docs.user}
              projectSet={layered.docs.project !== undefined}
              projectName={layerProject}
              onChange={(layer, value) =>
                layer === "user"
                  ? (layered.docs.user = value)
                  : (layered.docs.project = value)}
            />
          {/snippet}
        </PageItem>
      </OriginGroup>
      <OriginGroup
        origin={{ kind: "user" }}
        count={1}
        projectName={layerProject}
        locked
      >
        <PageItem
          icon={BookOpenIcon}
          title="release-notes"
          summary="Untrusted project file: one lock on the label; the project switch is disabled and shows User's value"
        >
          {#snippet meta()}
            <LayerSwitches
              name="release-notes"
              user={layered.core.user}
              projectName={layerProject}
              locked
              onChange={() => {}}
            />
          {/snippet}
        </PageItem>
      </OriginGroup>
      <OriginGroup
        origin={{ kind: "agent-browser" }}
        count={0}
        projectName={layerProject}
        emptyText="No agent-browser skills yet."
      >
        {null}
      </OriginGroup>
    </GallerySpecimen>
    <GallerySpecimen
      title="ColumnLabels + LayerCells"
      source="presentation/settings/ColumnLabels.svelte"
      layout="stack"
    >
      <p class="text-caption text-muted-foreground">
        Quiet text above the card, no header row inside it. Labels and controls
        share the fixed, centered `LayerCells` columns. Project-defined blocks
        hide the User label; an untrusted file puts one lock on the project
        label.
      </p>
      <div class="flex justify-end pr-[calc(--spacing(3)+1px)]">
        <ColumnLabels projectName={layerProject} chevron />
      </div>
      <PageList ariaLabel="Column labels">
        <PageItem title="Both layers" summary="Radios in the same cells">
          {#snippet meta()}
            <LayerCells projectName={layerProject}>
              {#snippet user()}<input
                  type="radio"
                  checked
                  aria-label="User"
                />{/snippet}
              {#snippet project()}<input
                  type="radio"
                  aria-label="Project"
                />{/snippet}
            </LayerCells>
          {/snippet}
        </PageItem>
      </PageList>
      <div class="flex justify-end pr-[calc(--spacing(3)+1px)]">
        <ColumnLabels projectName={layerProject} projectOnly chevron />
      </div>
      <PageList ariaLabel="Project-only column labels">
        <PageItem title="Project-only" summary="The User cell stays empty">
          {#snippet meta()}
            <LayerCells projectName={layerProject}>
              {#snippet project()}<input
                  type="radio"
                  checked
                  aria-label="Project"
                />{/snippet}
            </LayerCells>
          {/snippet}
        </PageItem>
      </PageList>
      <div class="flex justify-end pr-[calc(--spacing(3)+1px)]">
        <ColumnLabels projectName={layerProject} locked chevron />
      </div>
    </GallerySpecimen>
    <GallerySpecimen
      title="LayerEnabledTable"
      source="presentation/settings/LayerEnabledTable.svelte"
      layout="stack"
    >
      <LayerEnabledTable
        name="core"
        description="Detail pages put layer switches in a card right under the header, with the labels on a short line above it."
        projectName={layerProject}
        user={layered.core.user}
        project={layered.core.project ?? layered.core.user}
        projectSet={layered.core.project !== undefined}
        onChange={(layer, value) =>
          layer === "user"
            ? (layered.core.user = value)
            : (layered.core.project = value)}
      />
      <LayerEnabledTable
        name="core"
        title="Available"
        description="Without a project there is only the User column and no labels."
        user={layered.core.user}
        onChange={(_, value) => (layered.core.user = value)}
      />
    </GallerySpecimen>
    <GallerySpecimen
      title="LayerRow + SplitColumns"
      source="presentation/settings/LayerRow.svelte"
      layout="stack"
    >
      <SettingsSection
        title="Defaults"
        divided
        splitLabels={columnsShown ? splitLabels : undefined}
      >
        <LayerRow
          label="Header style"
          description="Wide controls: label on the full width, then User and project halves, each [control][↺]."
          projectName={columnsShown ? layerProject : undefined}
          overriddenIn={layerModelProject !== layerModelUser
            ? layerProject
            : undefined}
          projectReset={layerModelProject !== layerModelUser
            ? {
                label: "Follow User",
                onReset: () => (layerModelProject = layerModelUser),
              }
            : undefined}
        >
          {#snippet user()}
            <SelectField
              items={headerStyles}
              bind:value={layerModelUser}
              ariaLabel="User header style"
            />
          {/snippet}
          {#snippet project()}
            <SelectField
              items={headerStyles}
              bind:value={layerModelProject}
              ariaLabel="Project header style"
            />
          {/snippet}
        </LayerRow>
      </SettingsSection>
    </GallerySpecimen>
    <GallerySpecimen
      title="ProjectColumnsToggle + ProjectOverrideMark"
      source="presentation/settings/ProjectColumnsToggle.svelte"
    >
      <ProjectColumnsToggle
        id="lab-project-columns"
        checked={columnsShown}
        count={layerModelProject !== layerModelUser ? 1 : 0}
        onCheckedChange={(next) => (columnsShown = next)}
      />
      <ProjectOverrideMark projectName={layerProject} />
    </GallerySpecimen>
    <GallerySpecimen
      title="LevelMenu"
      source="presentation/settings/LevelMenu.svelte"
    >
      <LevelMenu label="New profile" icon={PlusIcon} onSelect={() => {}} />
      <LevelMenu
        label="New profile"
        icon={PlusIcon}
        projectName={layerProject}
        onSelect={() => {}}
      />
    </GallerySpecimen>
  </GalleryGroup>
</div>

{#snippet splitLabels()}
  <SplitColumns projectName={layerProject} />
{/snippet}
