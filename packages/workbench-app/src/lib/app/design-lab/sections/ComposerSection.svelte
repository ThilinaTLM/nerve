<script lang="ts">
import type { ConversationAgentUsage } from "@nervekit/contracts/core";
import {
  capabilityToolSettingsFromSettings,
  emptyCapabilityOverrides,
  type CapabilityConfiguration,
  type CapabilitySelection,
} from "@nervekit/contracts/capabilities";
import type {
  ContextUsage,
  ModelInfo,
  ThinkingLevel,
} from "@nervekit/contracts/models";
import type { PermissionRuleSetSummary } from "@nervekit/contracts/permissions";
import { defaultSettings } from "@nervekit/contracts/settings";
import type { TodoItem } from "@nervekit/contracts/tools";
import GitCommitIcon from "@lucide/svelte/icons/git-commit-horizontal";
import GitPullRequestIcon from "@lucide/svelte/icons/git-pull-request";
import PromptSuggestionChips from "$lib/features/conversations/views/PromptSuggestionChips.svelte";
import AgentComposer from "$lib/presentation/conversations/AgentComposer.svelte";
import type {
  ConversationComposerModel,
  ConversationPaneActions,
} from "$lib/presentation/conversations/conversation-view-contracts";
import ComposerCapabilitiesPopover from "$lib/presentation/composer/ComposerCapabilitiesPopover.svelte";
import ComposerModelPicker from "$lib/presentation/composer/ComposerModelPicker.svelte";
import VoiceMicButton from "$lib/presentation/composer/VoiceMicButton.svelte";
import ComposerShell from "$lib/presentation/composer/ComposerShell.svelte";
import ComposerToolbar from "$lib/presentation/composer/ComposerToolbar.svelte";
import ContextProgressBadge from "$lib/presentation/composer/ContextProgressBadge.svelte";
import type { CapabilitySkillRow } from "$lib/presentation/composer/capability-skill-row";
import type { ConversationSessionInfo } from "$lib/presentation/composer/session-info";
import TodoProgressChip from "$lib/presentation/composer/TodoProgressChip.svelte";
import { modelKey } from "$lib/presentation/utils/model";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";

const noop = () => {};
const stamp = "2026-10-14T09:30:00.000Z";

/* ------------------------------ Fixtures ------------------------------ */

const models: ModelInfo[] = [
  {
    provider: "anthropic",
    modelId: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    label: "Claude Sonnet 4",
    reasoning: true,
    input: ["text", "image"],
    supportedThinkingLevels: ["off", "low", "medium", "high"],
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
  },
  {
    provider: "anthropic",
    modelId: "claude-opus-4",
    name: "Claude Opus 4",
    label: "Claude Opus 4",
    reasoning: true,
    input: ["text", "image"],
    supportedThinkingLevels: ["off", "low", "medium", "high", "xhigh"],
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
  },
  {
    provider: "openai",
    modelId: "gpt-5",
    name: "GPT-5",
    label: "GPT-5",
    reasoning: true,
    input: ["text", "image"],
    supportedThinkingLevels: ["minimal", "low", "medium", "high"],
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
  },
];

const permissionRuleSets: PermissionRuleSetSummary[] = [
  {
    id: "read_only",
    name: "Read only",
    description: "Cannot modify files or run commands.",
    source: "builtin",
    enabled: true,
    available: true,
  },
  {
    id: "default",
    name: "Ask before changes",
    description: "Prompts for risky actions.",
    source: "builtin",
    enabled: true,
    available: true,
  },
  {
    id: "autonomous",
    name: "Autonomous",
    description: "Runs without prompting.",
    source: "builtin",
    enabled: true,
    available: true,
  },
];

const todos: TodoItem[] = [
  { todo: "Reproduce the flaky reconnect test", done: true },
  { todo: "Fix replay ordering", done: true },
  { todo: "Add regression test", done: false },
  { todo: "Update changelog", done: false },
];
const todosDone: TodoItem[] = todos.map((item) => ({ ...item, done: true }));

const session: ConversationSessionInfo = {
  fields: [
    { label: "Conversation", value: "conv_01HZY8K3", mono: true },
    { label: "Agent", value: "agent_01HZY8K4", mono: true },
    { label: "Model", value: "anthropic:claude-sonnet-4" },
    { label: "Working directory", value: "/home/user/project", mono: true },
  ],
  onCopy: noop,
};

const usage = {
  responseCount: 14,
  input: 182_000,
  output: 21_400,
  cacheRead: 640_000,
  cacheWrite: 38_000,
  totalTokens: 881_400,
  cost: 1.84,
};

const subagentUsage = {
  responseCount: 9,
  input: 96_000,
  output: 12_300,
  cacheRead: 410_000,
  cacheWrite: 20_000,
  totalTokens: 538_300,
  cost: 0.9,
};
const sumUsage = (a: typeof usage, b: typeof usage): typeof usage => ({
  responseCount: a.responseCount + b.responseCount,
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  totalTokens: a.totalTokens + b.totalTokens,
  cost: a.cost + b.cost,
});
const agentUsageExamples: {
  title: string;
  agentUsage?: ConversationAgentUsage;
  loading?: boolean;
  error?: string;
}[] = [
  {
    title: "Agent usage: no sub-agents",
    agentUsage: {
      own: usage,
      subagents: {
        ...usage,
        responseCount: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: 0,
      },
      total: usage,
      subagentCount: 0,
    },
  },
  {
    title: "Agent usage: sub-agents",
    agentUsage: {
      own: usage,
      subagents: subagentUsage,
      total: sumUsage(usage, subagentUsage),
      subagentCount: 3,
    },
  },
  { title: "Agent usage: loading", loading: true },
  { title: "Agent usage: unavailable", error: "Request failed" },
];

const contextLevels: { title: string; usage: ContextUsage }[] = [
  {
    title: "5%",
    usage: { tokens: 10_000, contextWindow: 200_000, percent: 5 },
  },
  {
    title: "35%",
    usage: { tokens: 70_000, contextWindow: 200_000, percent: 35 },
  },
  {
    title: "80% (warning)",
    usage: { tokens: 160_000, contextWindow: 200_000, percent: 80 },
  },
  {
    title: "95% (error)",
    usage: { tokens: 190_000, contextWindow: 200_000, percent: 95 },
  },
];

const selection = (): CapabilitySelection => ({
  disabledTools: ["web_search"],
  toolProfiles: {},
  toolSettings: capabilityToolSettingsFromSettings(defaultSettings),
  disabledFileSkills: [],
  enabledNerveSkills: [],
  enabledAgentBrowserSkills: [],
});
const capabilityConfiguration: CapabilityConfiguration = {
  project: emptyCapabilityOverrides(),
  conversation: emptyCapabilityOverrides(),
  inherited: selection(),
  effective: selection(),
  availableTools: ["jira", "web_search", "web_fetch"],
  toolProfileOptions: {
    jira: [{ id: "ner", name: "NER" }],
    confluence: [],
    web_search: [],
  },
  trust: {
    status: "trusted",
    digest: "d",
    trustedDigest: "d",
    trustedAt: stamp,
  },
};
const capabilitySkills: CapabilitySkillRow[] = [
  {
    key: "file:review",
    name: "review",
    source: "project",
    kind: "file",
    enabled: true,
    overridden: false,
    matchesInherited: true,
    inheritedFrom: "project",
  },
  {
    key: "file:deploy",
    name: "deploy",
    source: "user",
    kind: "file",
    enabled: false,
    overridden: true,
    matchesInherited: false,
    inheritedFrom: "user",
  },
  {
    key: "nerve:plan",
    name: "plan",
    source: "nerve",
    kind: "nerve",
    enabled: true,
    overridden: false,
    matchesInherited: true,
    inheritedFrom: "user",
  },
];

const suggestions = [
  {
    id: "commit",
    label: "Commit changes",
    prompt: "Stage and commit the current changes with a conventional message.",
    icon: GitCommitIcon,
  },
  {
    id: "pr",
    label: "Create a PR",
    prompt: "Push the branch and open a pull request.",
    icon: GitPullRequestIcon,
  },
];

/* ------------------------------ State ------------------------------ */

let draftText = $state(
  "Refactor the session store so replay and reconnect are separate modules",
);
let thinkingLevel = $state<ThinkingLevel>("medium");
let selectedModel = $state(modelKey(models[0]));
let agentProfile = $state("coding");
const agentProfiles = [
  { name: "coding", label: "Coding" },
  { name: "planning", label: "Planning" },
];

const composerBase = $derived<ConversationComposerModel>({
  text: "",
  models,
  selectedModelKey: selectedModel,
  thinkingLevel,
  agentProfile,
  agentProfiles,
  permissionRuleSetId: "default",
  permissionRuleSets,
  contextUsage: { tokens: 70_000, contextWindow: 200_000, percent: 35 },
  contextWindow: 200_000,
  conversationUsage: usage,
  session,
  todos,
  capabilityConfiguration,
  capabilitySkills,
});

const composerVariants = $derived<
  { title: string; model: ConversationComposerModel }[]
>([
  { title: "Typing", model: { ...composerBase, text: draftText } },
  {
    title: "Planning profile",
    model: { ...composerBase, agentProfile: "planning" },
  },
  {
    title: "Running (stop shown; sends are queued)",
    model: {
      ...composerBase,
      text: "After that, also bump the version.",
      sending: true,
      showStop: true,
    },
  },
  {
    title: "Shell command (!)",
    model: { ...composerBase, text: "!git status" },
  },
  {
    title: "Pending question (answered in the transcript card)",
    model: { ...composerBase, pendingQuestion: true },
  },
  {
    title: "Pending approval",
    model: {
      ...composerBase,
      pendingApproval: true,
      hint: "A tool call is waiting for approval.",
    },
  },
]);

const actions: ConversationPaneActions = {
  onComposerChange: (text) => (draftText = text),
  onModelChange: (value) => (selectedModel = value),
  onThinkingLevelChange: (value) => (thinkingLevel = value),
  onAgentProfileChange: (value) => (agentProfile = value),
  onSubmit: () => (draftText = ""),
  onAbort: noop,
  onCompact: noop,
  onGoToQuestion: noop,
  // Mock-only: resolves a fake path so the attach button is documented.
  onAttachFile: async (file) => `/tmp/attachments/${file.name || "file"}`,
};

// Mock-only mic: click cycles idle -> recording -> transcribing -> idle.
let micState = $state<"idle" | "recording" | "transcribing">("idle");
function cycleMic() {
  micState =
    micState === "idle"
      ? "recording"
      : micState === "recording"
        ? "transcribing"
        : "idle";
}
</script>

{#snippet guarded(error: unknown)}
  <p class="text-xs text-destructive" role="alert">
    Specimen failed to render: {error instanceof Error
      ? error.message
      : String(error)}
  </p>
{/snippet}

{#snippet suggestionHeader()}
  <PromptSuggestionChips {suggestions} onSend={noop} onDraft={noop} />
{/snippet}

{#snippet mockMic()}
  <VoiceMicButton
    recording={micState === "recording"}
    transcribing={micState === "transcribing"}
    idleLabel="Record voice prompt"
    title="Mock mic: click to cycle idle, recording, transcribing"
    onToggle={cycleMic}
    onContextMenu={(event) => {
      event.preventDefault();
      micState = "idle";
    }}
  />
{/snippet}

<div class="flex flex-col gap-10">
  <GalleryGroup
    title="In context: docked composer"
    description="The composer at the bottom of a 760px conversation column, with prompt suggestion chips above it (as in the app)."
  >
    <GallerySpecimen
      title="AgentComposer — idle"
      description="One card: text on top, a single bottom toolbar. Left: mode, model, permissions, capabilities; right: todos, context, then mic and send."
      source="presentation/conversations/AgentComposer"
      usage="2 files · conversation, shell"
      layout="bare"
    >
      <div
        class="mx-auto flex h-80 w-[760px] max-w-full flex-col justify-end overflow-hidden rounded-md border bg-background pt-2"
      >
        <svelte:boundary failed={guarded}>
          <AgentComposer
            model={composerBase}
            {actions}
            header={suggestionHeader}
            sendLeading={mockMic}
          />
        </svelte:boundary>
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Composer states"
    description="Same composer in the states that occur while working. Mode, model and thinking level are interactive."
  >
    <GallerySpecimen
      title="AgentComposer"
      description="Typing, planning (info border), running with queued send, shell command (warning border), pending question, pending approval."
      source="presentation/conversations/AgentComposer"
      usage="2 files · conversation, shell"
      layout="bare"
    >
      <div class="mx-auto flex w-[760px] max-w-full flex-col gap-8">
        {#each composerVariants as variant (variant.title)}
          <div class="flex min-w-0 flex-col gap-1">
            <span class="text-xs text-muted-foreground">{variant.title}</span>
            <div class="rounded-md border bg-background pt-2">
              <svelte:boundary failed={guarded}>
                <AgentComposer
                  model={variant.model}
                  {actions}
                  sendLeading={mockMic}
                />
              </svelte:boundary>
            </div>
          </div>
        {/each}
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="ComposerShell"
      description="One card with editor and toolbar slots; the shell appends the divider and the stop / send cluster to the toolbar row."
      source="presentation/composer/ComposerShell"
      usage="1 file · conversation"
      layout="bare"
    >
      <div class="grid gap-4 md:grid-cols-3">
        {#each [{ t: "Send enabled", stop: false, disabled: false }, { t: "Send disabled", stop: false, disabled: true }, { t: "Running (stop)", stop: true, disabled: false }] as variant (variant.t)}
          <div class="flex flex-col gap-1">
            <span class="text-xs text-muted-foreground">{variant.t}</span>
            <div class="rounded-md border bg-background">
              <ComposerShell
                agentProfile="coding"
                showStop={variant.stop}
                submitDisabled={variant.disabled}
                sendAriaLabel="Send prompt"
                sendTitle="Send prompt"
                onSubmit={noop}
              >
                {#snippet toolbar()}<span class="sr-only">toolbar slot</span
                  >{/snippet}
                {#snippet editor()}<div
                    class="min-h-16 px-3 py-2 text-sm text-muted-foreground"
                  >
                    Editor slot
                  </div>{/snippet}
              </ComposerShell>
            </div>
          </div>
        {/each}
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Toolbar chips"
    description="The composer's bottom toolbar and each ghost chip on its own. Permissions show a label only when not the default rule set."
  >
    <GallerySpecimen
      title="ComposerToolbar"
      description="Coding, Planning, and a non-default (Autonomous) rule set. Renders into a ComposerShell toolbar row."
      source="presentation/composer/ComposerToolbar"
      usage="1 file · conversation"
      layout="bare"
    >
      <div class="grid gap-x-6 gap-y-8 lg:grid-cols-2">
        {#each [{ t: "Coding", planning: false, permission: "default" }, { t: "Planning", planning: true, permission: "default" }, { t: "Autonomous", planning: false, permission: "autonomous" }] as const as variant (variant.t)}
          <div class="flex flex-col gap-1">
            <span class="text-xs text-muted-foreground">{variant.t}</span>
            <div class="rounded-md border bg-background">
              <ComposerShell
                agentProfile={variant.planning ? "planning" : "coding"}
                submitDisabled={false}
                sendAriaLabel="Send"
                sendTitle="Send"
                onSubmit={noop}
              >
                {#snippet toolbar()}
                  <ComposerToolbar
                    controlsDisabled={false}
                    profileDisabled={false}
                    modelDisabled={false}
                    {agentProfiles}
                    agentProfile={variant.planning ? "planning" : "coding"}
                    onAgentProfileChange={noop}
                    permissionRuleSetId={variant.permission}
                    {permissionRuleSets}
                    contextUsage={{
                      tokens: 70_000,
                      contextWindow: 200_000,
                      percent: 35,
                    }}
                    contextWindow={200_000}
                    conversationUsage={usage}
                    {session}
                    {todos}
                    {models}
                    selectedModelKey={selectedModel}
                    {thinkingLevel}
                    onModelChange={(value) => (selectedModel = value)}
                    onThinkingLevelChange={(value) => (thinkingLevel = value)}
                    onCompact={noop}
                    {capabilityConfiguration}
                    {capabilitySkills}
                  />
                {/snippet}
                {#snippet editor()}<div
                    class="min-h-16 px-3 py-2 text-sm text-muted-foreground"
                  >
                    Editor slot
                  </div>{/snippet}
              </ComposerShell>
            </div>
          </div>
        {/each}
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="ContextProgressBadge"
      description="Fill levels: neutral, warning from about 75%, destructive from about 90%. Click for the popover."
      source="presentation/composer/ContextProgressBadge"
      usage="1 file · composer"
      surface="panel"
      layout="bare"
    >
      <div class="flex flex-wrap items-center gap-x-6 gap-y-4">
        {#each contextLevels as level (level.title)}
          <div class="flex flex-col items-start gap-1">
            <span class="text-xs text-muted-foreground">{level.title}</span>
            <ContextProgressBadge
              contextUsage={level.usage}
              contextWindow={200_000}
              {session}
              conversationUsage={usage}
              onCompact={noop}
            />
          </div>
        {/each}
        {#each agentUsageExamples as example (example.title)}
          <div class="flex flex-col items-start gap-1">
            <span class="text-xs text-muted-foreground">{example.title}</span>
            <ContextProgressBadge
              contextUsage={{
                tokens: 70_000,
                contextWindow: 200_000,
                percent: 35,
              }}
              contextWindow={200_000}
              agentUsage={example.agentUsage}
              agentUsageLoading={example.loading}
              agentUsageError={example.error}
              onUsageOpenChange={noop}
              onUsageRetry={noop}
              onCompact={noop}
            />
          </div>
        {/each}
        <div class="flex flex-col items-start gap-1">
          <span class="text-xs text-muted-foreground">Compacting</span>
          <ContextProgressBadge
            contextUsage={{
              tokens: 160_000,
              contextWindow: 200_000,
              percent: 80,
            }}
            contextWindow={200_000}
            compacting
            onCompact={noop}
          />
        </div>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="TodoProgressChip"
      description="Partial (info) and all done (success). Click for the checklist popover."
      source="presentation/composer/TodoProgressChip"
      usage="1 file · composer"
      surface="panel"
    >
      <TodoProgressChip {todos} />
      <TodoProgressChip todos={todosDone} />
    </GallerySpecimen>

    <GallerySpecimen
      title="ComposerModelPicker"
      description="Model chip with reasoning effort. Default, disabled and no models."
      source="presentation/composer/ComposerModelPicker"
      usage="1 file · composer"
      surface="panel"
    >
      <ComposerModelPicker
        {models}
        selectedModelKey={selectedModel}
        {thinkingLevel}
        onModelChange={(value) => (selectedModel = value)}
        onThinkingLevelChange={(value) => (thinkingLevel = value)}
        modelShortcut="Ctrl+M"
        thinkingShortcut="Ctrl+T"
      />
      <ComposerModelPicker
        {models}
        selectedModelKey={modelKey(models[0])}
        thinkingLevel="medium"
        disabled
      />
      <ComposerModelPicker
        models={[]}
        selectedModelKey=""
        emptyMessage="No models available. Configure a provider in this host."
      />
    </GallerySpecimen>

    <GallerySpecimen
      title="ComposerCapabilitiesPopover"
      description="Tools / Skills / Sub-agents tabs: configured, loading, error."
      source="presentation/composer/ComposerCapabilitiesPopover"
      usage="1 file · composer"
      surface="panel"
    >
      <ComposerCapabilitiesPopover
        configuration={capabilityConfiguration}
        skills={capabilitySkills}
        onPatch={noop}
        onReset={noop}
        onRefresh={noop}
        onOpenSettings={noop}
      />
      <ComposerCapabilitiesPopover
        configuration={capabilityConfiguration}
        skills={capabilitySkills}
        loading
      />
      <ComposerCapabilitiesPopover
        configuration={capabilityConfiguration}
        skills={[]}
        error="Could not load capabilities."
      />
    </GallerySpecimen>

    <GallerySpecimen
      title="VoiceMicButton"
      description="Toolbar mic is an outline icon button (pairs with the filled Send) and shows state only: mic (idle), red mic with a pulsing dot (recording; never the square run-stop), X (transcribing). Progress lives in the editor's dictation chip, never next to the button."
      source="presentation/composer/VoiceMicButton"
      usage="2 files · composer, ask-user"
    >
      {#each [{ t: "Idle", r: false, x: false }, { t: "Recording", r: true, x: false }, { t: "Transcribing", r: false, x: true }] as state (state.t)}
        <div class="flex items-center gap-2">
          <VoiceMicButton
            recording={state.r}
            transcribing={state.x}
            idleLabel="Record voice prompt"
            onToggle={noop}
            onContextMenu={noop}
          />
          <span class="text-xs text-muted-foreground">{state.t}</span>
        </div>
      {/each}
    </GallerySpecimen>

    <GallerySpecimen
      title="PromptSuggestionChips"
      description="Outline chips above the composer; click sends, right-click drafts."
      source="features/conversations/views/PromptSuggestionChips"
      usage="1 file · composer"
    >
      <PromptSuggestionChips {suggestions} onSend={noop} onDraft={noop} />
    </GallerySpecimen>
  </GalleryGroup>
</div>
