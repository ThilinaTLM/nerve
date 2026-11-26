<!--
  Renders the one configuration review dialog for the whole app. Any surface
  opens it with `openConfigurationReview`; this host adds the effects the view
  does not own: Details (the item's Settings page) and opening a source file.
-->
<script lang="ts">
import type { ConfigurationReviewTarget } from "@nervekit/contracts/configuration";
import { configurationReviewQueue as queue } from "$lib/application/configuration-review/configuration-review-queue.svelte";
import { reviewTargetPage } from "$lib/application/configuration-review/review-target-page";
import { agentProfileCatalog } from "$lib/application/agent-profiles/agent-profile-catalog.svelte";
import {
  openProjectSettingsPane,
  openSettingsPane,
} from "$lib/application/settings";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { openFilePane } from "$lib/features/filesystem/state/file-tabs.svelte";
import { responsive } from "$lib/app/shell/responsive.svelte";
import { createClock } from "$lib/presentation/clock/clock.svelte";
import ConfigurationReviewDialog from "$lib/presentation/configuration-review/ConfigurationReviewDialog.svelte";

const clock = createClock(() => (queue.open ? 30_000 : undefined));
const phone = $derived(responsive.isPhone);

/** A sub-agent-only profile is listed on Sub-Agents; the rest on Agents. */
function profilePageOf(target: ConfigurationReviewTarget) {
  const profile = agentProfileCatalog
    .profiles(target.projectId ?? workspaceState.selectedProjectId)
    .find(
      (option) =>
        option.name === target.id &&
        (option.source ?? "builtin") === target.scope,
    );
  return profile?.usableBy === "subagent"
    ? ("sub-agents" as const)
    : ("agents" as const);
}

function openDetails(): void {
  const target = queue.current;
  const page = target ? reviewTargetPage(target, profilePageOf) : undefined;
  if (!page) return;
  queue.close();
  const options = page.item ? { item: page.item } : {};
  if (page.scope === "project" && page.projectId)
    void openProjectSettingsPane(page.projectId, page.pageId, options);
  else void openSettingsPane(page.pageId, options);
}

/** The file viewer opens a file within a project; a user file opens in the open one. */
const sourceProjectId = $derived(
  queue.current?.projectId ?? workspaceState.selectedProjectId,
);

function openSource(path: string): void {
  const projectId = sourceProjectId;
  if (!projectId) return;
  queue.close();
  void openFilePane({ projectId, path });
}
</script>

<ConfigurationReviewDialog
  open={queue.open}
  review={queue.review}
  loading={queue.phase === "loading"}
  position={queue.index}
  total={queue.targets.length}
  busy={queue.busy}
  error={queue.error}
  notice={queue.notice}
  now={clock.now}
  onClose={() => queue.close()}
  onPrevious={() => queue.previous()}
  onNext={() => queue.next()}
  onSkip={() => queue.skip()}
  onTrust={() => void queue.trust()}
  onDecline={() => void queue.decline()}
  onRetry={() => void queue.reload()}
  onDetails={phone || !queue.current || !reviewTargetPage(queue.current)
    ? undefined
    : openDetails}
  onOpenSource={phone || !sourceProjectId ? undefined : openSource}
/>
