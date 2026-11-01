import Wrench from "@lucide/svelte/icons/wrench";
import BookOpen from "@lucide/svelte/icons/book-open";
import Users from "@lucide/svelte/icons/users";
import Folder from "@lucide/svelte/icons/folder";
import Globe from "@lucide/svelte/icons/globe";
import User from "@lucide/svelte/icons/user";
import Sparkles from "@lucide/svelte/icons/sparkles";
import type { Component } from "svelte";
import type { CapabilityToolName } from "@nervekit/contracts/capabilities";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import {
  skillOverrideKind,
  sortBySkillSource,
  type AvailableSkill,
} from "@nervekit/contracts/skills";
import type { AgentEditorView } from "./agent-editor-view";
import {
  capabilityToolGroupsFor,
  type CapabilityToolGroup,
} from "./capability-tool-labels";
import {
  capabilitySubagentCounts,
  capabilitySubagentEnabled,
  type CapabilitySubagentProfile,
} from "./capability-subagent-profiles";
import {
  capabilityToolLocks,
  editableToolOverrideResets,
} from "./capability-tool-locks";

export type CapabilityKind = "tools" | "skills" | "subagents";
export type CapabilitySettingsPage = "tools" | "skills" | "sub-agents";

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
  onConfigureTool?: (group: CapabilityToolGroup) => void;
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

/** Rows, counts and overrides for the conversation's tools, skills and
 * sub-agents. `close` runs before an action leaves the panel (configure a
 * tool, open settings) so the owning surface can dismiss itself. */
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
      subagents:
        Object.keys(overrides?.subagents ?? {}).length +
        Number(overrides?.tools?.subagents !== undefined),
    };
  });

  readonly overrideCount = $derived(
    this.overrideCounts.tools +
      this.overrideCounts.skills +
      this.overrideCounts.subagents,
  );

  readonly #toolRows = $derived.by<CapabilityRow[]>(() => {
    const { configuration, onPatch, onConfigureTool } = this.props;
    const groups = capabilityToolGroupsFor(
      Object.keys(
        configuration?.resolution.settings.tools ?? {},
      ) as CapabilityToolName[],
    );
    return groups
      .filter((g) => g.key !== "bash")
      .map((group) => {
        const locks = capabilityToolLocks(
          group.names,
          configuration?.resolution.provenance,
        );
        const resets = editableToolOverrideResets(
          group.names,
          configuration?.overrides,
          configuration?.resolution.provenance,
        );
        const configurable =
          !!onConfigureTool &&
          group.names.some(
            (name) => name !== "web_fetch" && name !== "subagents",
          );
        return {
          key: group.key,
          label: group.label,
          group: "Built-in",
          keywords: group.searchText ? [group.searchText] : undefined,
          enabled: group.names.every(
            (name) =>
              name === "bash" ||
              (configuration?.resolution.settings.tools?.[name] &&
                "enabled" in configuration.resolution.settings.tools[name]! &&
                configuration.resolution.settings.tools[name]!.enabled ===
                  true),
          ),
          overridden: resets.length > 0,
          lockedBy: locks.enabledBy,
          configure: configurable
            ? () => {
                this.#close();
                this.props.onConfigureTool?.(group);
              }
            : undefined,
          toggle: (enabled) =>
            onPatch?.({
              tools: Object.fromEntries(
                group.names.map((name) => [name, { enabled }]),
              ),
            }),
          reset: () => onPatch?.({}, resets),
        };
      });
  });

  readonly toolRows = $derived(
    this.#toolRows.filter((r) => r.key !== "subagents"),
  );

  /** The delegation switch, which gates every sub-agent launch. */
  readonly delegationRow = $derived(
    this.#toolRows.find((r) => r.key === "subagents"),
  );

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
    const { configuration, skills = [], subagentProfiles } = this.props;
    const counts = subagentProfiles
      ? capabilitySubagentCounts(
          subagentProfiles,
          configuration?.resolution.settings.subagents,
        )
      : undefined;
    return [
      {
        kind: "tools",
        title: "Tools",
        icon: Wrench,
        count: `${this.toolRows.filter((r) => r.enabled).length}/${this.toolRows.length}`,
      },
      {
        kind: "skills",
        title: "Skills",
        icon: BookOpen,
        count: `${this.skillRows.filter((r) => r.enabled).length}/${skills.length}`,
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
    return kind === "tools"
      ? this.toolRows
      : kind === "skills"
        ? this.skillRows
        : this.subagentRows;
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
