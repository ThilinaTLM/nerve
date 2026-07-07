<script lang="ts">
  import {
    BookOpenText,
    Code2,
    FileText,
    Image as ImageIcon,
    MessageSquare,
    RefreshCw,
    TriangleAlert,
    X,
  } from "@lucide/svelte";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { isMarkdownPath } from "@nervekit/ui/core/utils/file-display";
  import type {
    SandboxWorkspaceFileViewState,
    SandboxWorkspaceTabIdentity,
  } from "../../state/sandbox-ui-types";

  let {
    tabs,
    activeTab,
    fileViewsById,
    onSelect,
    onClose,
    onRefresh,
    onToggleFileDisplayMode,
    onToggleFileLineWrap,
  }: {
    tabs: SandboxWorkspaceTabIdentity[];
    activeTab: SandboxWorkspaceTabIdentity;
    fileViewsById: Record<string, SandboxWorkspaceFileViewState>;
    onSelect: (tab: SandboxWorkspaceTabIdentity) => void;
    onClose: (tab: SandboxWorkspaceTabIdentity) => void;
    onRefresh: (tab: SandboxWorkspaceTabIdentity) => void;
    onToggleFileDisplayMode: (fileTabId: string) => void;
    onToggleFileLineWrap: (fileTabId: string) => void;
  } = $props();

  function sameTab(
    a: SandboxWorkspaceTabIdentity,
    b: SandboxWorkspaceTabIdentity,
  ): boolean {
    return a.kind === b.kind && a.id === b.id;
  }

  function fileLabel(view: SandboxWorkspaceFileViewState | undefined, id: string): string {
    const path = view?.content?.relativePath || view?.path || id;
    const parts = path.split("/").filter(Boolean);
    return parts.at(-1) ?? path;
  }

  function fileTitle(view: SandboxWorkspaceFileViewState | undefined, id: string): string {
    return view?.content?.path || view?.path || id;
  }

  function isMarkdownView(view: SandboxWorkspaceFileViewState | undefined): boolean {
    return Boolean(
      view &&
        (view.content?.type === "text" || !view.content) &&
        isMarkdownPath(view.content?.relativePath || view.path),
    );
  }

  function fileIcon(view: SandboxWorkspaceFileViewState | undefined) {
    if (view?.loading) return RefreshCw;
    if (view?.error) return TriangleAlert;
    if (view?.content?.type === "image") return ImageIcon;
    return FileText;
  }
</script>

<nav class="flex h-10 flex-none items-center border-b bg-muted/35" aria-label="Workspace tabs">
  <div class="flex min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label="Open workspace tabs">
    {#each tabs as tab (`${tab.kind}:${tab.id}`)}
      {@const active = sameTab(activeTab, tab)}
      {@const view = tab.kind === "file" ? fileViewsById[tab.id] : undefined}
      {@const Icon = tab.kind === "chat" ? MessageSquare : fileIcon(view)}
      <div
        class={`group flex min-w-0 max-w-56 items-center gap-1 border-r px-1.5 text-sm ${active ? "bg-background text-foreground" : "text-muted-foreground hover:bg-background/70 hover:text-foreground"} ${view?.error ? "text-destructive" : ""}`}
        role="presentation"
      >
        {#if tab.kind === "file" && isMarkdownView(view)}
          <button
            type="button"
            class="flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-muted"
            aria-label={view?.displayMode === "rendered" ? "Show raw markdown" : "Show rendered markdown"}
            title={view?.displayMode === "rendered" ? "Show raw markdown" : "Show rendered markdown"}
            onclick={(event) => {
              event.stopPropagation();
              onToggleFileDisplayMode(tab.id);
            }}
          >
            {#if view?.displayMode === "rendered"}
              <BookOpenText class="size-3.5" />
            {:else}
              <Code2 class="size-3.5" />
            {/if}
          </button>
        {:else}
          <span class="flex size-6 shrink-0 items-center justify-center" aria-hidden="true">
            <Icon class={`size-3.5 ${view?.loading ? "animate-spin" : ""}`} />
          </span>
        {/if}

        <button
          type="button"
          role="tab"
          aria-selected={active}
          class="min-w-0 flex-1 truncate py-2 text-left"
          title={tab.kind === "chat" ? "Sandbox chat" : fileTitle(view, tab.id)}
          onclick={() => onSelect(tab)}
        >
          {#if tab.kind === "chat"}
            Chat
          {:else}
            {fileLabel(view, tab.id)}
          {/if}
        </button>

        {#if tab.kind === "file"}
          {#if view?.content?.type === "text"}
            <Button
              variant="ghost"
              size="icon-sm"
              class="size-6 opacity-70 hover:opacity-100"
              ariaLabel={view.wrapLines ? "Disable line wrap" : "Enable line wrap"}
              title={view.wrapLines ? "Disable line wrap" : "Enable line wrap"}
              onclick={(event) => {
                event.stopPropagation();
                onToggleFileLineWrap(tab.id);
              }}
            >
              <Code2 class="size-3.5" />
            </Button>
          {/if}
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-6 opacity-70 hover:opacity-100"
            ariaLabel="Refresh file"
            title="Refresh file"
            onclick={(event) => {
              event.stopPropagation();
              onRefresh(tab);
            }}
          >
            <RefreshCw class={`size-3.5 ${view?.loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-6 opacity-70 hover:opacity-100"
            ariaLabel={`Close ${fileLabel(view, tab.id)}`}
            title="Close tab"
            onclick={(event) => {
              event.stopPropagation();
              onClose(tab);
            }}
          >
            <X class="size-3.5" />
          </Button>
        {/if}
      </div>
    {/each}
  </div>
</nav>
