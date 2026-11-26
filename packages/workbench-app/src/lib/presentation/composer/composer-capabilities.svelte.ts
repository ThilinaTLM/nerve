import BookOpen from "@lucide/svelte/icons/book-open";
import Users from "@lucide/svelte/icons/users";
import Folder from "@lucide/svelte/icons/folder";
import Globe from "@lucide/svelte/icons/globe";
import User from "@lucide/svelte/icons/user";
import Sparkles from "@lucide/svelte/icons/sparkles";
import type { Component } from "svelte";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import {
  skillOverrideKind,
  sortBySkillSource,
  type AvailableSkill,
} from "@nervekit/contracts/skills";
import type { AgentEditorView } from "./agent-editor-view";
import {
  capabilitySubagentCounts,
  capabilitySubagentEnabled,
  type CapabilitySubagentProfile,
} from "./capability-subagent-profiles";
import {
  capabilityToolLocks,
  editableToolOverrideResets,
} from "./capability-tool-locks";

export type CapabilityKind = "skills" | "subagents";
export type CapabilitySettingsPage = "skills" | "sub-agents";

export type CapabilityRow = {
  key: string;
  label: string;
  group: string;
  keywords?: string[];
  detail?: string;
  unavailable?: boolean;
  muted?: boolean;
  resetLabel?: string;
  enabled: boolean;
  overridden: boolean;
  warning?: string;
  configure?: () => void;
  lockedBy?: string;
  icon?: Component<{ class?: string; "aria-hidden"?: "true" }>;
  toggle: (enabled: boolean) => void;
  reset: () => void;
};

export type CapabilitySection = {
  kind: CapabilityKind;
  title: string;
  icon: Component<{ class?: string; "aria-hidden"?: "true" }>;
  count?: string;
};

/** Props shared by every surface that shows the conversation's capabilities. */
export type ComposerCapabilityProps = {
  configuration?: AgentEditorView;
  skills?: AvailableSkill[];
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  onPatch?: (changes: LeadSettingsOverrides, resets?: string[]) => void;
  onReset?: () => void;
  onRefresh?: () => void;
  onOpenSettings?: (page: CapabilitySettingsPage) => void;
  subagentProfiles?: CapabilitySubagentProfile[];
  subagentControlsEnabled?: boolean;
};

const skillSourceIcons = {
  user: User,
  project: Folder,
  nerve: Sparkles,
  agentBrowser: Globe,
};

const escape = (v: string) => v.replaceAll("~", "~0").replaceAll("/", "~1");

export function capabilitySettingsPage(
  kind: CapabilityKind,
): CapabilitySettingsPage {
  return kind === "subagents" ? "sub-agents" : kind;
}

/** Rows, counts and overrides for the conversation's skills and sub-agents.
 * Override counts also cover tool and MCP overrides, which the composer does
 * not edit but still resets. `close` runs before an action leaves the panel
 * (open settings) so the owning surface can dismiss itself. */
export class ComposerCapabilities {
  #props: () => ComposerCapabilityProps;
  #close: () => void;

  constructor(props: () => ComposerCapabilityProps, close: () => void) {
    this.#props = props;
    this.#close = close;
  }

  get props(): ComposerCapabilityProps {
    return this.#props();
  }

  readonly overrideCounts = $derived.by(() => {
    const overrides = this.props.configuration?.overrides;
    return {
      tools: Object.keys(overrides?.tools ?? {}).filter(
        (name) => name !== "subagents",
      ).length,
      skills: Object.values(overrides?.skills ?? {}).reduce(
        (n, group) => n + Object.keys(group).length,
        0,
      ),
      mcp: Object.keys(overrides?.mcpServers?.servers ?? {}).length,
      subagents:
        Object.keys(overrides?.subagents ?? {}).length +
        Number(overrides?.tools?.subagents !== undefined),
    };
  });

  readonly overrideCount = $derived(
    this.overrideCounts.tools +
      this.overrideCounts.skills +
      this.overrideCounts.mcp +
      this.overrideCounts.subagents,
  );

  /** Cheap, row-free input: the trigger badges need counts while the panels
   * are closed, so row objects (locks, resets, closures) stay lazy. */
  readonly #skillCount = $derived.by(() => {
    const { configuration, skills = [] } = this.props;
    const settings = configuration?.resolution.settings.skills;
    const enabled = skills.filter((skill) => {
      const kind = skillOverrideKind(skill.source);
      return (
        (settings?.[kind]?.[skill.name] ??
          settings?.defaults?.[kind] ??
          false) === true
      );
    }).length;
    return `${enabled}/${skills.length}`;
  });

  /** The delegation switch (the `subagents` tool), which gates every
   * sub-agent launch. */
  readonly delegationRow = $derived.by<CapabilityRow | undefined>(() => {
    const { configuration, onPatch } = this.props;
    const tools = configuration?.resolution.settings.tools;
    if (!tools || !("subagents" in tools)) return undefined;
    const names = ["subagents"];
    const subagents = tools.subagents;
    const resets = editableToolOverrideResets(
      names,
      configuration.overrides,
      configuration.resolution.provenance,
    );
    return {
      key: "subagents",
      label: "Delegation",
      group: "Built-in",
      enabled:
        !!subagents && "enabled" in subagents && subagents.enabled === true,
      overridden: resets.length > 0,
      lockedBy: capabilityToolLocks(names, configuration.resolution.provenance)
        .enabledBy,
      toggle: (enabled) => onPatch?.({ tools: { subagents: { enabled } } }),
      reset: () => onPatch?.({}, resets),
    };
  });

  readonly skillRows = $derived.by<CapabilityRow[]>(() => {
    const { configuration, skills = [], onPatch } = this.props;
    return sortBySkillSource(skills).map((skill) => {
      const kind = skillOverrideKind(skill.source);
      const pointer = `/skills/${kind}/${escape(skill.name)}`;
      const provenance =
        configuration?.resolution.provenance[pointer] ??
        configuration?.resolution.provenance[`/skills/defaults/${kind}`];
      return {
        key: `${kind}:${skill.name}`,
        label: skill.name,
        group: {
          user: "User",
          project: "Project",
          nerve: "Nerve",
          agentBrowser: "Agent Browser",
        }[skill.source],
        keywords: [skill.source],
        enabled:
          configuration?.resolution.settings.skills?.[kind]?.[skill.name] ??
          configuration?.resolution.settings.skills?.defaults?.[kind] ??
          false,
        overridden:
          configuration?.overrides.skills?.[kind]?.[skill.name] !== undefined &&
          provenance?.source !== "requirement",
        icon: skillSourceIcons[skill.source],
        lockedBy:
          provenance?.source === "requirement" ? provenance.profile : undefined,
        toggle: (enabled) =>
          onPatch?.({ skills: { [kind]: { [skill.name]: enabled } } }),
        reset: () => onPatch?.({}, [`/overrides${pointer}`]),
      };
    });
  });

  readonly subagentRows = $derived.by<CapabilityRow[]>(() => {
    const {
      configuration,
      subagentProfiles = [],
      subagentControlsEnabled = false,
      onPatch,
    } = this.props;
    return subagentProfiles.map((profile) => {
      const source =
        configuration?.resolution.provenance[
          `/subagents/${escape(profile.name)}/enabled`
        ];
      return {
        key: profile.name,
        label: profile.label,
        group: "Sub-agents",
        detail: profile.whenToUse,
        keywords: profile.whenToUse ? [profile.whenToUse] : undefined,
        enabled: capabilitySubagentEnabled(
          profile,
          configuration?.resolution.settings.subagents,
        ),
        overridden: Boolean(configuration?.overrides.subagents?.[profile.name]),
        warning: profile.error,
        unavailable: Boolean(profile.error) || !subagentControlsEnabled,
        muted: Boolean(profile.error) || this.delegationRow?.enabled === false,
        lockedBy: source?.source === "requirement" ? source.profile : undefined,
        resetLabel: `Reset ${profile.label} launch choices; requirements remain effective`,
        configure: () => this.openSettings("subagents"),
        toggle: (enabled) =>
          onPatch?.({ subagents: { [profile.name]: { enabled } } }),
        reset: () =>
          onPatch?.({}, [`/overrides/subagents/${escape(profile.name)}`]),
      };
    });
  });

  readonly sections = $derived.by<CapabilitySection[]>(() => {
    const { configuration, subagentProfiles } = this.props;
    const counts = subagentProfiles
      ? capabilitySubagentCounts(
          subagentProfiles,
          configuration?.resolution.settings.subagents,
        )
      : undefined;
    return [
      {
        kind: "skills",
        title: "Skills",
        icon: BookOpen,
        count: this.#skillCount,
      },
      {
        kind: "subagents",
        title: "Sub-agents",
        icon: Users,
        count: counts ? `${counts.available}/${counts.total}` : undefined,
      },
    ];
  });

  rows(kind: CapabilityKind): CapabilityRow[] {
    return kind === "skills" ? this.skillRows : this.subagentRows;
  }

  rowDisabled(row: CapabilityRow): boolean {
    const { disabled = false, loading = false } = this.props;
    return (
      disabled || loading || Boolean(row.lockedBy) || Boolean(row.unavailable)
    );
  }

  toggleRow(row: CapabilityRow): void {
    if (!this.rowDisabled(row)) row.toggle(!row.enabled);
  }

  openSettings(kind: CapabilityKind): void {
    this.#close();
    this.props.onOpenSettings?.(capabilitySettingsPage(kind));
  }
}
