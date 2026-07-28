<script lang="ts">
import GitBranch from "@lucide/svelte/icons/git-branch";
import GitMerge from "@lucide/svelte/icons/git-merge";
import Tag from "@lucide/svelte/icons/tag";
import Users from "@lucide/svelte/icons/users";
import type { GithubPrDetail } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nervekit/ui-kit/components/ui/card";
import { divergenceLabel, divergenceTone, reviewTone } from "./pr-pane-helpers";

type Props = { detail: GithubPrDetail };
let { detail }: Props = $props();
</script>

<Card>
  <CardHeader class="border-b py-3">
    <CardTitle class="text-sm">Overview</CardTitle>
  </CardHeader>
  <CardContent class="space-y-4 py-4 text-sm">
    <div class="flex items-start gap-2">
      <GitMerge class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div class="min-w-0">
        <p class="font-medium">Mergeability</p>
        <div class="mt-1 flex flex-wrap gap-1.5">
          <Badge
            tone={detail.mergeable === "MERGEABLE"
              ? "good"
              : detail.mergeable === "CONFLICTING"
                ? "danger"
                : "neutral"}
          >
            {detail.mergeable?.toLowerCase() ?? "calculating"}
          </Badge>
          {#if detail.reviewDecision}
            <Badge tone={reviewTone(detail.reviewDecision)}>
              {detail.reviewDecision.replaceAll("_", " ").toLowerCase()}
            </Badge>
          {/if}
        </div>
      </div>
    </div>

    <div class="flex items-start gap-2">
      <GitBranch class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div>
        <p class="font-medium">Base branch</p>
        <Badge tone={divergenceTone(detail)} class="mt-1">
          {divergenceLabel(detail)}
        </Badge>
      </div>
    </div>

    <div class="flex items-start gap-2">
      <Users class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div class="min-w-0">
        <p class="font-medium">Reviewers</p>
        {#if detail.reviewRequests.length > 0}
          <p class="mt-1 text-muted-foreground">
            {detail.reviewRequests.map((reviewer) => reviewer.login).join(", ")}
          </p>
        {:else}
          <p class="mt-1 text-muted-foreground">No pending review requests</p>
        {/if}
      </div>
    </div>

    <div class="flex items-start gap-2">
      <Tag class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div class="min-w-0">
        <p class="font-medium">Labels</p>
        {#if detail.labels.length > 0}
          <div class="mt-1 flex flex-wrap gap-1">
            {#each detail.labels as label (label.name)}
              <Badge variant="outline">{label.name}</Badge>
            {/each}
          </div>
        {:else}
          <p class="mt-1 text-muted-foreground">No labels</p>
        {/if}
      </div>
    </div>
  </CardContent>
</Card>
