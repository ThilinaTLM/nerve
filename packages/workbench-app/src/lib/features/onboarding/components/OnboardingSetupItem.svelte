<script lang="ts">
import type { Component } from "svelte";
import { Badge, type BadgeTone } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";

type Props = {
  icon: Component;
  iconClass: string;
  title: string;
  status: string;
  statusTone: BadgeTone;
  description: string;
  actionLabel: string;
  actionVariant?: "outline" | "primary";
  onAction: () => void;
};

let {
  icon: Icon,
  iconClass,
  title,
  status,
  statusTone,
  description,
  actionLabel,
  actionVariant = "outline",
  onAction,
}: Props = $props();
</script>

<section class="rounded-lg border border-border px-3 py-2">
  <div class="flex min-w-0 gap-3">
    <Icon class={`mt-0.5 size-5 flex-none ${iconClass}`} aria-hidden="true" />
    <div class="grid min-w-0 flex-1 gap-1">
      <div class="flex items-center justify-between gap-3">
        <div class="flex flex-nowrap items-center gap-2">
          <h3 class="whitespace-nowrap text-sm font-medium text-foreground">
            {title}
          </h3>
          <Badge tone={statusTone} size="xs">{status}</Badge>
        </div>
        <Button
          variant={actionVariant === "primary" ? "default" : "outline"}
          size="xs"
          onclick={onAction}
        >
          {actionLabel}
        </Button>
      </div>
      <p class="text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  </div>
</section>
