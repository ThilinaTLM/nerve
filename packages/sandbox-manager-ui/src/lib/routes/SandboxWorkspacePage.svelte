<script lang="ts">
  import {
    Activity,
    ArrowDown,
    ArrowLeft,
    MessageSquareOff,
    PanelLeftOpen,
    PanelRight,
  } from "@lucide/svelte";
  import {
    buildConversationRenderProjection,
    createConversationScrollController,
    TranscriptList,
  } from "@nervekit/conversation-ui";
  import { setConversationUiCapabilities } from "@nervekit/conversation-ui/context";
  import type { ThinkingLevel } from "@nervekit/shared";
  import { Button } from "@nervekit/ui/components/ui/button";
  import {
    Handle,
    Pane,
    PaneGroup,
  } from "@nervekit/ui/components/ui/resizable";
  import SelectField from "@nervekit/ui/components/ui/select-field";
  import type { SelectItem } from "@nervekit/ui/components/ui/select-field";
  import SandboxPromptComposer from "../components/composer/SandboxPromptComposer.svelte";
  import AppShell from "../components/layout/AppShell.svelte";
  import SandboxActionMenu from "../components/SandboxActionMenu.svelte";
  import SandboxBootProgress from "../components/SandboxBootProgress.svelte";
  import SandboxDiagnosticsSheet from "../components/SandboxDiagnosticsSheet.svelte";
  import SandboxStatusBadge from "../components/SandboxStatusBadge.svelte";
  import SandboxFilePane from "../components/workspace/SandboxFilePane.svelte";
  import SandboxWorkspaceTabStrip from "../components/workspace/SandboxWorkspaceTabStrip.svelte";
  import WorkspaceAgentList from "../components/workspace/WorkspaceAgentList.svelte";
  import WorkspaceInspector from "../components/workspace/WorkspaceInspector.svelte";
  import SandboxConfigView from "./SandboxConfigView.svelte";
  import SandboxEventsView from "./SandboxEventsView.svelte";
  import SandboxLogsView from "./SandboxLogsView.svelte";
  import {
    computeSandboxBootProgress,
    isSandboxConnected,
    isSandboxTerminal,
  } from "../state/sandbox-boot-progress";
  import {
    sandboxMessageMenu,
    sandboxToolMenu,
  } from "../state/sandbox-conversation-menus";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import {
    pendingApprovalRecords,
    pendingUserQuestionRecord,
  } from "../state/sandbox-review-records";
  import { resolveToolCallDetails } from "../state/sandbox-tool-call-details";
  import type { SandboxWorkspaceTabIdentity } from "../state/sandbox-ui-types";
  import { modelKey } from "../utils/model-display";
  import type { SandboxManagerRouteState } from "./route-state.svelte";

  let {
    route,
    sandboxId,
  }: { route: SandboxManagerRouteState; sandboxId: string } = $props();

  const store = useSandboxManagerStore();
  const chatTab: SandboxWorkspaceTabIdentity = { kind: "chat", id: "chat" };
  const defaultWorkspaceTabs: SandboxWorkspaceTabIdentity[] = [chatTab];
  const record = $derived(
    store.sandboxes.find((item) => item.sandboxId === sandboxId),
  );
  const detail = $derived(store.details[sandboxId]);
  const workspaceTabs = $derived(
    detail?.openWorkspaceTabs ?? defaultWorkspaceTabs,
  );
  const activeWorkspaceTab = $derived(detail?.activeWorkspaceTab ?? chatTab);
  const workspaceFileViews = $derived(detail?.workspaceFileViewsById ?? {});
  const activeFileView = $derived(
    activeWorkspaceTab.kind === "file"
      ? workspaceFileViews[activeWorkspaceTab.id]
      : undefined,
  );
  const richState = $derived(
    detail?.selectedConversationId
      ? detail.conversationViewsById[detail.selectedConversationId]
      : Object.values(detail?.conversationViewsById ?? {})[0],
  );
  const connected = $derived(isSandboxConnected(detail));
  const render = $derived(buildConversationRenderProjection(richState));
  const progress = $derived(computeSandboxBootProgress(record, detail));
  const booting = $derived(
    !connected && !isSandboxTerminal(record) && progress.state !== "failed",
  );
  const hasContent = $derived(
    render.timeline.length > 0 || Boolean(render.streamingText),
  );
  const lastTimelineKey = $derived(render.timeline.at(-1)?.key);
  const transcriptHeightCacheKey = $derived(
    `${sandboxId}:${detail?.selectedConversationId ?? "default"}`,
  );
  const scrollConversationId = $derived(
    detail?.selectedConversationId ?? richState?.conversationId ?? "default",
  );
  const scroll = createConversationScrollController({
    conversationOpen: () => hasContent,
    conversationId: () => scrollConversationId,
    contentReady: () => render.timeline.length > 0,
  });

  const conversationItems = $derived<SelectItem[]>(
    (detail?.snapshot?.conversations ?? []).map((conversation) => ({
      value: conversation.conversationId,
      label: conversation.title ?? conversation.conversationId,
    })),
  );

  const activeRun = $derived(
    richState?.activeRun ??
      (detail?.selectedRunId ? detail.liveRuns[detail.selectedRunId] : undefined),
  );
  const canCancel = $derived(
    activeRun?.status === "running" ||
      activeRun?.status === "queued" ||
      activeRun?.status === "streaming",
  );
  // An empty conversation snapshot defaults `readOnly` to true; only treat it as
  // blocking when there is actual transcript content (a genuine read-only
  // session), otherwise the first prompt could never be sent.
  const readOnly = $derived(Boolean(richState?.readOnly) && hasContent);

  // The sandbox ConversationSnapshot does not carry approval/question records,
  // so reconstruct them from the live wait reducer state (see the helpers).
  const approvals = $derived(pendingApprovalRecords(detail, richState));
  const pendingUserQuestion = $derived(pendingUserQuestionRecord(detail, richState));
  const blockedForReview = $derived(
    approvals.length > 0 || Boolean(pendingUserQuestion),
  );

  const composerDisabled = $derived(
    isSandboxTerminal(record) ||
      progress.state === "failed" ||
      (detail?.sending ?? false) ||
      readOnly ||
      blockedForReview,
  );

  // Agent controls surfaced by the composer toolbar.
  const controls = $derived(detail?.agentControls);
  const selectedModelKey = $derived(
    controls
      ? modelKey({ provider: controls.provider, modelId: controls.model })
      : "",
  );
  const selectedModel = $derived(
    store.models.find((model) => modelKey(model) === selectedModelKey),
  );
  const composerHint = $derived(
    detail?.queuedPrompt
      ? "Message queued — sends when the sandbox is ready."
      : progress.state === "failed"
        ? "Sandbox startup failed — fix the sandbox and restart it before chatting."
        : booting
          ? "Sandbox is booting — your message will send when ready."
          : undefined,
  );

  function handleModelChange(key: string): void {
    if (!detail || !controls) return;
    const model = store.models.find((item) => modelKey(item) === key);
    if (!model) return;
    controls.provider = model.provider;
    controls.model = model.modelId;
    const supported = model.supportedThinkingLevels?.length
      ? model.supportedThinkingLevels
      : (["off"] as ThinkingLevel[]);
    if (!supported.includes(controls.thinkingLevel))
      controls.thinkingLevel = supported[0];
    void store.configureAgent(sandboxId, {
      model: {
        provider: controls.provider,
        model: controls.model,
        thinkingLevel: controls.thinkingLevel,
      },
    });
  }

  function handleThinkingLevelChange(level: ThinkingLevel): void {
    if (!detail || !controls) return;
    controls.thinkingLevel = level;
    void store.configureAgent(sandboxId, {
      model: {
        provider: controls.provider,
        model: controls.model,
        thinkingLevel: level,
      },
    });
  }

  function handleModeChange(mode: "normal" | "planning"): void {
    if (!controls) return;
    controls.mode = mode;
    void store.configureAgent(sandboxId, { mode });
  }

  function handlePermissionChange(
    level: "read_only" | "supervised" | "autonomous",
  ): void {
    if (!controls) return;
    controls.permissionLevel = level;
    void store.configureAgent(sandboxId, { permissionLevel: level });
  }

  function handleApprovalPolicyChange(policy: {
    autoApproveReadOnly: boolean;
  }): void {
    if (!controls) return;
    controls.approvalPolicy = policy;
    void store.configureAgent(sandboxId, { approvalPolicy: policy });
  }

  function handleWorkspaceTabRefresh(tab: SandboxWorkspaceTabIdentity): void {
    if (tab.kind === "chat") {
      void store.recoverConversationSnapshot(sandboxId).catch(() => undefined);
      return;
    }
    if (tab.kind === "file") {
      void store.refreshWorkspaceFile(sandboxId, tab.id);
      return;
    }
    if (tab.id === "logs") void store.loadLogs(sandboxId);
    if (tab.id === "config") void store.loadSandboxConfigYaml(sandboxId);
  }

  // Tool-call details dialog resolves the full sandbox record when connected.
  setConversationUiCapabilities({
    fetchToolCall: (toolCallId) =>
      resolveToolCallDetails(richState, sandboxId, toolCallId, { connected }),
  });

  let diagnosticsOpen = $state(false);

  // Inspector drawer (right) — collapsible, persisted, and open by default.
  const INSPECTOR_KEY = "nerve.sandboxManager.inspectorOpen";
  function readInspectorPref(): boolean | undefined {
    if (typeof localStorage === "undefined") return undefined;
    const value = localStorage.getItem(INSPECTOR_KEY);
    return value === null ? undefined : value === "1";
  }
  let inspectorOpen = $state(readInspectorPref() ?? true);
  function setInspectorOpen(next: boolean): void {
    inspectorOpen = next;
    if (typeof localStorage !== "undefined")
      localStorage.setItem(INSPECTOR_KEY, next ? "1" : "0");
  }

  // Agent list (left) — collapsible, persisted, and open by default.
  const AGENT_LIST_KEY = "nerve.sandboxManager.agentListOpen";
  function readAgentListPref(): boolean | undefined {
    if (typeof localStorage === "undefined") return undefined;
    const value = localStorage.getItem(AGENT_LIST_KEY);
    return value === null ? undefined : value === "1";
  }
  let agentListOpen = $state(readAgentListPref() ?? true);
  function setAgentListOpen(next: boolean): void {
    agentListOpen = next;
    if (typeof localStorage !== "undefined")
      localStorage.setItem(AGENT_LIST_KEY, next ? "1" : "0");
  }

  // Auto-dispatch a queued first prompt once the controller connects.
  $effect(() => {
    if (connected && detail?.queuedPrompt) void store.flushQueuedPrompt(sandboxId);
  });
</script>

{#snippet chatWorkspace()}
  {#if booting && record}
    <div class="flex-none border-b p-3 lg:hidden">
      <SandboxBootProgress {record} variant="banner" />
    </div>
  {/if}

  <section
    class="relative mx-auto grid min-h-0 w-full max-w-4xl flex-1 grid-rows-[minmax(0,1fr)_auto]"
  >
    {#if hasContent}
      <div
        class="grid min-h-0 min-w-0"
        role="log"
        aria-label="Conversation transcript"
        aria-live="polite"
      >
        <TranscriptList
          bind:controller={scroll.controller}
          bind:atEnd={scroll.atEnd}
          timeline={render.timeline}
          streamingText={render.streamingText}
          sending={richState?.sending ?? detail?.sending ?? false}
          hasLiveTimelineNodes={render.hasLiveTimelineNodes}
          queuedPrompts={render.queuedPrompts}
          contentVisibility={true}
          followBottom={scroll.followBottom}
          paddingEnd={18}
          heightCacheKey={transcriptHeightCacheKey}
          {approvals}
          {pendingUserQuestion}
          {lastTimelineKey}
          onGrantApproval={(id) =>
            void store.resolveApproval(sandboxId, id, "grant")}
          onDenyApproval={(id) =>
            void store.resolveApproval(sandboxId, id, "deny")}
          onAnswerUserQuestion={(questionId, answer) =>
            void store.submitInput(sandboxId, questionId, answer)}
          onOpenFile={(path, line) =>
            void store.openWorkspaceFile(sandboxId, path, line)}
          messageMenu={sandboxMessageMenu}
          toolMenu={sandboxToolMenu}
        />
      </div>
    {:else if booting && record}
      <div class="flex min-h-0 flex-col items-center justify-center gap-4 p-6">
        <div class="w-full max-w-md">
          <SandboxBootProgress {record} variant="banner" />
        </div>
        <p class="max-w-md text-center text-sm text-muted-foreground">
          You can type your first message now — it'll send automatically when
          the sandbox is ready.
        </p>
      </div>
    {:else}
      <div class="flex min-h-0 flex-col items-center justify-center gap-2 p-4 text-center">
        <MessageSquareOff class="size-8 text-muted-foreground" />
        <p class="text-sm text-muted-foreground">
          {connected
            ? "No conversation yet. Send a prompt to start a run."
            : progress.state === "failed"
              ? "Sandbox startup failed. Review the boot details and restart after fixing the config."
              : "No controller session connected. Chat is read-only until the sandbox reconnects."}
        </p>
      </div>
    {/if}

    {#if hasContent && !scroll.atEnd && scroll.composerHeight > 0}
      <div class="absolute right-4 z-10" style={`bottom: ${scroll.composerHeight + 8}px;`}>
        <Button
          class="rounded-full"
          variant="secondary"
          size="icon-sm"
          ariaLabel="Scroll to latest"
          title="Scroll to latest"
          onclick={() => scroll.jumpToBottom()}
        >
          <ArrowDown class="size-4" />
        </Button>
      </div>
    {/if}

    {#if detail && controls}
      <div class="min-w-0" bind:this={scroll.composerWrapEl}>
        <SandboxPromptComposer
          text={detail.composerText}
          disabled={composerDisabled}
          sending={canCancel}
          models={store.models}
          {selectedModelKey}
          thinkingLevel={controls.thinkingLevel}
          mode={controls.mode}
          permissionLevel={controls.permissionLevel}
          approvalPolicy={controls.approvalPolicy}
          contextUsage={richState?.contextUsage}
          contextWindow={selectedModel?.contextWindow ?? 0}
          hint={composerHint}
          onChange={(text) => {
            if (detail) detail.composerText = text;
          }}
          onSubmit={() =>
            void store.submitPrompt(sandboxId, detail.composerText)}
          onAbort={canCancel ? () => void store.cancelRun(sandboxId) : undefined}
          onModelChange={handleModelChange}
          onThinkingLevelChange={handleThinkingLevelChange}
          onModeChange={handleModeChange}
          onPermissionChange={handlePermissionChange}
          onApprovalPolicyChange={handleApprovalPolicyChange}
        />
      </div>
    {/if}
  </section>
{/snippet}

{#snippet centerWorkspace()}
  <div class="flex h-full min-h-0 min-w-0 flex-col bg-background">
    <SandboxWorkspaceTabStrip
      tabs={workspaceTabs}
      activeTab={activeWorkspaceTab}
      fileViewsById={workspaceFileViews}
      onSelect={(tab) => store.selectWorkspaceTab(sandboxId, tab)}
      onClose={(tab) => store.closeWorkspaceTab(sandboxId, tab)}
      onRefresh={handleWorkspaceTabRefresh}
      onToggleFileDisplayMode={(fileTabId) =>
        store.toggleWorkspaceFileDisplayMode(sandboxId, fileTabId)}
      onToggleFileLineWrap={(fileTabId) =>
        store.toggleWorkspaceFileLineWrap(sandboxId, fileTabId)}
    />

    {#if record?.lastError}
      <p class="flex-none border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
        {record.lastError.code}: {record.lastError.message}
      </p>
    {/if}

    <div class="min-h-0 min-w-0 flex-1">
      {#if activeWorkspaceTab.kind === "file"}
        <SandboxFilePane view={activeFileView} />
      {:else if activeWorkspaceTab.kind === "diagnostic" && record}
        {#if activeWorkspaceTab.id === "logs"}
          <SandboxLogsView {record} />
        {:else if activeWorkspaceTab.id === "config"}
          <SandboxConfigView {record} />
        {:else}
          <SandboxEventsView {record} />
        {/if}
      {:else}
        <div class="flex h-full min-h-0 min-w-0 flex-col">
          {@render chatWorkspace()}
        </div>
      {/if}
    </div>
  </div>
{/snippet}

<AppShell {route} contentVariant="full">
  <div class="flex flex-none flex-wrap items-center gap-3 border-b px-4 py-2.5">
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Back to fleet"
      onclick={() => route.fleet()}
    >
      <ArrowLeft class="size-4" />
    </Button>
    {#if !agentListOpen}
      <Button
        variant="ghost"
        size="icon-sm"
        class="hidden lg:inline-flex"
        ariaLabel="Show sandbox list"
        title="Show sandbox list"
        onclick={() => setAgentListOpen(true)}
      >
        <PanelLeftOpen class="size-4" />
      </Button>
    {/if}
    <div class="flex min-w-0 flex-col">
      <span class="truncate text-sm font-semibold">{record?.name ?? sandboxId}</span>
      <span class="truncate font-mono text-xs text-muted-foreground">{sandboxId}</span>
    </div>
    {#if record}<SandboxStatusBadge {record} />{/if}

    <div class="ml-auto flex items-center gap-2">
      {#if conversationItems.length > 1 && detail}
        <SelectField
          items={conversationItems}
          value={detail.selectedConversationId ?? ""}
          ariaLabel="Select conversation"
          class="max-w-xs"
          onValueChange={(value) => {
            if (!detail) return;
            detail.selectedConversationId = value;
            store.openWorkspaceChatTab(sandboxId);
          }}
        />
      {/if}
      {#if record}
        <Button
          variant="ghost"
          size="sm"
          class="hidden lg:inline-flex"
          active={inspectorOpen}
          onclick={() => setInspectorOpen(!inspectorOpen)}
        >
          <PanelRight class="size-4" /> Inspector
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="lg:hidden"
          onclick={() => (diagnosticsOpen = true)}
        >
          <Activity class="size-4" /> Diagnostics
        </Button>
        <SandboxActionMenu {record} compact />
      {/if}
    </div>
  </div>

  {#if !record}
    <div class="flex flex-1 items-center justify-center p-6">
      <div class="rounded-md border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        {detail?.loading ? "Loading sandbox…" : "Sandbox not found."}
      </div>
    </div>
  {:else}
    <div class="min-h-0 flex-1">
      <div class="hidden h-full min-h-0 lg:block">
        <PaneGroup
          direction="horizontal"
          autoSaveId="nerve.sandboxManager.workspace.v1"
          keyboardResizeBy={8}
        >
          {#if agentListOpen}
            <Pane defaultSize={20} minSize={14} maxSize={32} order={1}>
              <WorkspaceAgentList
                activeSandboxId={sandboxId}
                onSelect={(id) => route.openSandbox(id)}
                onCreate={() => (store.createDialogOpen = true)}
                onCollapse={() => setAgentListOpen(false)}
              />
            </Pane>
            <Handle aria-label="Resize sandbox list" />
          {/if}

          <Pane defaultSize={56} minSize={36} order={2}>
            {@render centerWorkspace()}
          </Pane>

          {#if inspectorOpen}
            <Handle aria-label="Resize inspector" />
            <Pane defaultSize={24} minSize={19} maxSize={40} order={3}>
              <div class="h-full min-w-0 border-l">
                <WorkspaceInspector
                  {record}
                  onClose={() => setInspectorOpen(false)}
                  onOpenDiagnosticTab={(id) => store.openWorkspaceDiagnosticTab(sandboxId, id)}
                />
              </div>
            </Pane>
          {/if}
        </PaneGroup>
      </div>

      <div class="flex h-full min-h-0 flex-col lg:hidden">
        {@render centerWorkspace()}
      </div>
    </div>

    <SandboxDiagnosticsSheet
      bind:open={diagnosticsOpen}
      {record}
      onOpenDiagnosticTab={(id) => store.openWorkspaceDiagnosticTab(sandboxId, id)}
    />
  {/if}
</AppShell>
