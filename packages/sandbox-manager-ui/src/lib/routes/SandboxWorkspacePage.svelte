<script lang="ts">
  import { ArrowDown, MessageSquareOff } from "@lucide/svelte";
  import {
    buildConversationRenderProjection,
    createConversationScrollController,
    TranscriptList,
  } from "@nervekit/conversation-ui";
  import { setConversationUiCapabilities } from "@nervekit/conversation-ui/context";
  import type { ThinkingLevel } from "@nervekit/shared";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { WorkbenchFrame, WorkbenchPanes } from "@nervekit/ui/components/workbench";
  import SandboxPromptComposer from "../components/composer/SandboxPromptComposer.svelte";
  import SandboxBootProgress from "../components/SandboxBootProgress.svelte";
  import SandboxFilePane from "../components/workspace/SandboxFilePane.svelte";
  import SandboxNavigatorShell from "../components/workspace/SandboxNavigatorShell.svelte";
  import SandboxUtilityPanel from "../components/workspace/SandboxUtilityPanel.svelte";
  import SandboxWorkspaceTabStrip from "../components/workspace/SandboxWorkspaceTabStrip.svelte";
  import SandboxFooterbar from "../components/layout/SandboxFooterbar.svelte";
  import SandboxTitlebar from "../components/layout/SandboxTitlebar.svelte";
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
  import {
    closeDrawers,
    sandboxResponsive,
    sandboxWorkbenchLayout,
    setNavDrawerOpen,
    setSidebarCollapsed,
    setUtilityCollapsed,
    setUtilityDrawerOpen,
  } from "../state/sandbox-workbench-layout.svelte";
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

  const activeRun = $derived(
    richState?.activeRun ??
      (detail?.selectedRunId ? detail.liveRuns[detail.selectedRunId] : undefined),
  );
  const canCancel = $derived(
    activeRun?.status === "running" ||
      activeRun?.status === "queued" ||
      activeRun?.status === "streaming",
  );
  const readOnly = $derived(Boolean(richState?.readOnly) && hasContent);
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
  const isCompact = $derived(sandboxResponsive.isCompact);
  const isPhone = $derived(sandboxResponsive.isPhone);
  const sidebarCollapsed = $derived(
    isCompact ? !sandboxWorkbenchLayout.navDrawerOpen : sandboxWorkbenchLayout.sidebarCollapsed,
  );
  const utilityCollapsed = $derived(
    isCompact ? !sandboxWorkbenchLayout.utilityDrawerOpen : sandboxWorkbenchLayout.utilityCollapsed,
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
    if (!supported.includes(controls.thinkingLevel)) controls.thinkingLevel = supported[0];
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
    void store.configureAgent(sandboxId, { model: { provider: controls.provider, model: controls.model, thinkingLevel: level } });
  }

  function handleModeChange(mode: "normal" | "planning"): void {
    if (!controls) return;
    controls.mode = mode;
    void store.configureAgent(sandboxId, { mode });
  }

  function handlePermissionChange(level: "read_only" | "supervised" | "autonomous"): void {
    if (!controls) return;
    controls.permissionLevel = level;
    void store.configureAgent(sandboxId, { permissionLevel: level });
  }

  function handleApprovalPolicyChange(policy: { autoApproveReadOnly: boolean }): void {
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

  function toggleSidebar(): void {
    if (isCompact) setNavDrawerOpen(!sandboxWorkbenchLayout.navDrawerOpen);
    else setSidebarCollapsed(!sandboxWorkbenchLayout.sidebarCollapsed);
  }

  function toggleUtility(): void {
    if (isCompact) setUtilityDrawerOpen(!sandboxWorkbenchLayout.utilityDrawerOpen);
    else setUtilityCollapsed(!sandboxWorkbenchLayout.utilityCollapsed);
  }

  setConversationUiCapabilities({
    fetchToolCall: (toolCallId) =>
      resolveToolCallDetails(richState, sandboxId, toolCallId, { connected }),
  });

  let lastTabKey: string | undefined;
  $effect(() => {
    const key = `${activeWorkspaceTab.kind}:${activeWorkspaceTab.id}`;
    if (key === lastTabKey) return;
    lastTabKey = key;
    if (sandboxWorkbenchLayout.navDrawerOpen) closeDrawers();
  });

  $effect(() => {
    if (!isCompact && (sandboxWorkbenchLayout.navDrawerOpen || sandboxWorkbenchLayout.utilityDrawerOpen)) closeDrawers();
  });

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

  <section class="relative mx-auto grid min-h-0 w-full max-w-4xl flex-1 grid-rows-[minmax(0,1fr)_auto]">
    {#if hasContent}
      <div class="grid min-h-0 min-w-0" role="log" aria-label="Conversation transcript" aria-live="polite">
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
          onGrantApproval={(id) => void store.resolveApproval(sandboxId, id, "grant")}
          onDenyApproval={(id) => void store.resolveApproval(sandboxId, id, "deny")}
          onAnswerUserQuestion={(questionId, answer) => void store.submitInput(sandboxId, questionId, answer)}
          onOpenFile={(path, line) => void store.openWorkspaceFile(sandboxId, path, line)}
          messageMenu={sandboxMessageMenu}
          toolMenu={sandboxToolMenu}
        />
      </div>
    {:else if booting && record}
      <div class="flex min-h-0 flex-col items-center justify-center gap-4 p-6">
        <div class="w-full max-w-md"><SandboxBootProgress {record} variant="banner" /></div>
        <p class="max-w-md text-center text-sm text-muted-foreground">You can type your first message now — it'll send automatically when the sandbox is ready.</p>
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
        <Button class="rounded-full" variant="secondary" size="icon-sm" ariaLabel="Scroll to latest" title="Scroll to latest" onclick={() => scroll.jumpToBottom()}>
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
          onChange={(text) => { if (detail) detail.composerText = text; }}
          onSubmit={() => void store.submitPrompt(sandboxId, detail.composerText)}
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
      onCloseOther={(tab) => store.closeOtherWorkspaceTabs(sandboxId, tab)}
      onCloseLeft={(tab) => store.closeWorkspaceTabsLeft(sandboxId, tab)}
      onCloseRight={(tab) => store.closeWorkspaceTabsRight(sandboxId, tab)}
      onToggleFileDisplayMode={(fileTabId) => store.toggleWorkspaceFileDisplayMode(sandboxId, fileTabId)}
      onToggleFileLineWrap={(fileTabId) => store.toggleWorkspaceFileLineWrap(sandboxId, fileTabId)}
      onNewConversation={() => store.startNewConversation(sandboxId)}
    />

    {#if record?.lastError}
      <p class="flex-none border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">{record.lastError.code}: {record.lastError.message}</p>
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
        <div class="flex h-full min-h-0 min-w-0 flex-col">{@render chatWorkspace()}</div>
      {/if}
    </div>
  </div>
{/snippet}

<WorkbenchFrame>
  {#snippet titlebar()}
    <SandboxTitlebar {route} {record} {sandboxId} />
  {/snippet}

  {#snippet workspace()}
    {#if !record}
      <div class="flex h-full items-center justify-center bg-background p-6">
        <div class="rounded-md border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {detail?.loading ? "Loading sandbox…" : "Sandbox not found."}
        </div>
      </div>
    {:else}
      <WorkbenchPanes
        compact={isCompact}
        {sidebarCollapsed}
        {utilityCollapsed}
        navDrawerOpen={sandboxWorkbenchLayout.navDrawerOpen}
        utilityDrawerOpen={sandboxWorkbenchLayout.utilityDrawerOpen}
        autoSaveId="nerve.sandboxManager.workbench.v1"
        leftLabel="Sandbox navigator"
        rightLabel="Sandbox utility panel"
        onNavDrawerOpenChange={setNavDrawerOpen}
        onUtilityDrawerOpenChange={setUtilityDrawerOpen}
      >
        {#snippet left()}
          <SandboxNavigatorShell
            activeSandboxId={sandboxId}
            onSelectSandbox={(id) => route.openSandbox(id)}
            onSelectConversation={(conversationId) => store.selectConversation(sandboxId, conversationId)}
            onCreateSandbox={() => (store.createDialogOpen = true)}
            onNewConversation={() => store.startNewConversation(sandboxId)}
          />
        {/snippet}
        {#snippet center()}
          {@render centerWorkspace()}
        {/snippet}
        {#snippet right()}
          <SandboxUtilityPanel {record} onOpenDiagnosticTab={(id) => store.openWorkspaceDiagnosticTab(sandboxId, id)} />
        {/snippet}
      </WorkbenchPanes>
    {/if}
  {/snippet}

  {#snippet footer()}
    <SandboxFooterbar
      {record}
      {sandboxId}
      {sidebarCollapsed}
      {utilityCollapsed}
      phone={isPhone}
      onToggleSidebar={toggleSidebar}
      onToggleUtility={toggleUtility}
    />
  {/snippet}
</WorkbenchFrame>
