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
  import SelectField from "@nervekit/ui/components/ui/select-field";
  import type { SelectItem } from "@nervekit/ui/components/ui/select-field";
  import SandboxPromptComposer from "../components/composer/SandboxPromptComposer.svelte";
  import SandboxActionMenu from "../components/SandboxActionMenu.svelte";
  import SandboxBootProgress from "../components/SandboxBootProgress.svelte";
  import SandboxDiagnosticsSheet from "../components/SandboxDiagnosticsSheet.svelte";
  import WorkspaceAgentList from "../components/workspace/WorkspaceAgentList.svelte";
  import WorkspaceInspector from "../components/workspace/WorkspaceInspector.svelte";
  import SandboxStatusBadge from "../components/SandboxStatusBadge.svelte";
  import AppShell from "../components/layout/AppShell.svelte";
  import {
    sandboxMessageMenu,
    sandboxToolMenu,
  } from "../state/sandbox-conversation-menus";
  import {
    pendingApprovalRecords,
    pendingUserQuestionRecord,
  } from "../state/sandbox-review-records";
  import { resolveToolCallDetails } from "../state/sandbox-tool-call-details";
  import { modelKey } from "../utils/model-display";
  import {
    computeSandboxBootProgress,
    isSandboxConnected,
    isSandboxTerminal,
  } from "../state/sandbox-boot-progress";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import type { SandboxManagerRouteState } from "./route-state.svelte";

  let {
    route,
    sandboxId,
  }: { route: SandboxManagerRouteState; sandboxId: string } = $props();

  const store = useSandboxManagerStore();
  const record = $derived(
    store.sandboxes.find((item) => item.sandboxId === sandboxId),
  );
  const detail = $derived(store.details[sandboxId]);
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

  // Tool-call details dialog resolves the full sandbox record when connected.
  setConversationUiCapabilities({
    fetchToolCall: (toolCallId) =>
      resolveToolCallDetails(richState, sandboxId, toolCallId, { connected }),
  });

  let diagnosticsOpen = $state(false);

  // Inspector drawer (right) — collapsible, persisted; auto-collapses once the
  // sandbox is connected and ready for chat.
  const INSPECTOR_KEY = "nerve.sandboxManager.inspectorOpen";
  function readInspectorPref(): boolean | undefined {
    if (typeof localStorage === "undefined") return undefined;
    const value = localStorage.getItem(INSPECTOR_KEY);
    return value === null ? undefined : value === "1";
  }
  let inspectorOpen = $state(readInspectorPref() ?? true);
  let hasAutoCollapsed = false;
  function setInspectorOpen(next: boolean): void {
    inspectorOpen = next;
    if (typeof localStorage !== "undefined")
      localStorage.setItem(INSPECTOR_KEY, next ? "1" : "0");
  }
  $effect(() => {
    if (connected && !hasAutoCollapsed) {
      if (readInspectorPref() === undefined) inspectorOpen = false;
      hasAutoCollapsed = true;
    }
  });

  // Agent list (left) — collapsible, persisted; auto-collapses when there is a
  // single sandbox so a solo user isn't paying for the pane.
  const AGENT_LIST_KEY = "nerve.sandboxManager.agentListOpen";
  function readAgentListPref(): boolean | undefined {
    if (typeof localStorage === "undefined") return undefined;
    const value = localStorage.getItem(AGENT_LIST_KEY);
    return value === null ? undefined : value === "1";
  }
  let agentListOpen = $state(readAgentListPref() ?? store.sandboxes.length > 1);
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
            if (detail) detail.selectedConversationId = value;
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
    <div class="flex min-h-0 flex-1">
      {#if agentListOpen}
        <aside class="hidden shrink-0 lg:flex">
          <WorkspaceAgentList
            activeSandboxId={sandboxId}
            onSelect={(id) => route.openSandbox(id)}
            onCreate={() => (store.createDialogOpen = true)}
            onCollapse={() => setAgentListOpen(false)}
          />
        </aside>
      {/if}

      <!-- Chat column -->
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        {#if record.lastError}
          <p class="flex-none border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
            {record.lastError.code}: {record.lastError.message}
          </p>
        {/if}

        {#if booting}
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
                messageMenu={sandboxMessageMenu}
                toolMenu={sandboxToolMenu}
              />
            </div>
          {:else if booting}
            <div class="flex min-h-0 flex-col items-center justify-center gap-4 p-6">
              <div class="w-full max-w-md">
                <SandboxBootProgress {record} variant="banner" />
              </div>
              <p class="max-w-md text-center text-sm text-muted-foreground">
                You can type your first message now — it'll send automatically
                when the sandbox is ready.
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
                onAbort={canCancel
                  ? () => void store.cancelRun(sandboxId)
                  : undefined}
                onModelChange={handleModelChange}
                onThinkingLevelChange={handleThinkingLevelChange}
                onModeChange={handleModeChange}
                onPermissionChange={handlePermissionChange}
                onApprovalPolicyChange={handleApprovalPolicyChange}
              />
            </div>
          {/if}
        </section>
      </div>

      <!-- Inspector drawer -->
      {#if inspectorOpen}
        <aside class="hidden w-80 shrink-0 flex-col border-l lg:flex">
          <WorkspaceInspector {record} onClose={() => setInspectorOpen(false)} />
        </aside>
      {/if}
    </div>

    <SandboxDiagnosticsSheet bind:open={diagnosticsOpen} {record} />
  {/if}
</AppShell>
