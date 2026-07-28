<script lang="ts">
import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
import ExternalLink from "@lucide/svelte/icons/external-link";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import type { GithubPrDetail } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { formatPrDate, stateLabel, stateTone } from "./pr-pane-helpers";

type Props = {
  detail: GithubPrDetail;
  loading: boolean;
  onRefresh?: () => void;
  onCheckout?: () => void;
  onOpenExternal?: () => void;
};

let { detail, loading, onRefresh, onCheckout, onOpenExternal }: Props =
  $props();
</script>

<header class="border-b bg-background px-5 pt-4">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0 flex-1">
      <h1 class="text-xl font-semibold leading-tight text-foreground">
        {detail.title}
        <span class="font-normal text-muted-foreground">#{detail.number}</span>
      </h1>
      <div
        class="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        <Badge tone={stateTone(detail)}>{stateLabel(detail)}</Badge>
        <span>
          {detail.author ?? "Unknown author"} wants to merge
          <strong class="text-success"> {detail.commits.length} </strong>
          {detail.commits.length === 1 ? "commit" : "commits"} into
        </span>
        <Badge variant="outline" class="font-mono">{detail.baseRefName}</Badge>
        <span>from</span>
        <Badge variant="outline" class="font-mono">{detail.headRefName}</Badge>
      </div>
      <div class="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>opened {formatPrDate(detail.createdAt)}</span>
        <span>{detail.changedFiles} files changed</span>
        <span class="font-mono text-success">+{detail.additions}</span>
        <span class="font-mono text-destructive">−{detail.deletions}</span>
      </div>
    </div>

    <div class="flex shrink-0 gap-1.5">
      <Button
        size="sm"
        variant="outline"
        aria-label="Refresh pull request"
        disabled={loading}
        onclick={() => onRefresh?.()}
      >
        <RefreshCw class="size-4" />
        Refresh
      </Button>
      <Button
        size="icon-sm"
        variant="outline"
        aria-label="Open pull request in browser"
        onclick={() => onOpenExternal?.()}
      >
        <ExternalLink class="size-4" />
      </Button>
      <Button
        size="icon-sm"
        variant="outline"
        aria-label="Check out pull request branch"
        onclick={() => onCheckout?.()}
      >
        <ArrowDownToLine class="size-4" />
      </Button>
    </div>
  </div>
</header>
