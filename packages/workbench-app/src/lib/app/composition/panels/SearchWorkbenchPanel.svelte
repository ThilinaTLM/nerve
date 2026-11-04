<script lang="ts">
import {
  ContentSearchPanel,
  contentSearch,
  openFilePane,
} from "$lib/features/filesystem";
import { workspaceSelectors } from "$lib/application/workspace";

const projectId = $derived(workspaceSelectors.activeProject?.id);
let input = $state<HTMLInputElement | null>(null);

// Results belong to one project; switching projects starts a fresh search.
let lastProjectId: string | undefined;
$effect(() => {
  const current = projectId;
  if (lastProjectId !== undefined && current !== lastProjectId) {
    if (contentSearch.query.trim()) contentSearch.schedule(current, true);
    else contentSearch.clear();
  }
  lastProjectId = current;
});

$effect(() => {
  const token = contentSearch.focusToken;
  if (!input || token === contentSearch.handledFocusToken) return;
  contentSearch.handledFocusToken = token;
  input.focus();
  input.select();
  if (contentSearch.query.trim()) contentSearch.schedule(projectId, true);
});
</script>

<ContentSearchPanel
  hasProject={projectId !== undefined}
  bind:query={contentSearch.query}
  bind:regex={contentSearch.regex}
  bind:caseSensitive={contentSearch.caseSensitive}
  bind:wholeWord={contentSearch.wholeWord}
  bind:includeIgnored={contentSearch.includeIgnored}
  bind:include={contentSearch.include}
  bind:exclude={contentSearch.exclude}
  bind:showFilters={contentSearch.showFilters}
  bind:inputRef={input}
  status={contentSearch.status}
  response={contentSearch.resultProjectId === projectId
    ? contentSearch.response
    : undefined}
  error={contentSearch.error}
  onChange={() => contentSearch.schedule(projectId)}
  onSubmit={() => contentSearch.schedule(projectId, true)}
  onClear={() => contentSearch.clear()}
  onOpenMatch={(path, line) => {
    if (projectId) void openFilePane({ projectId, path, line });
  }}
/>
