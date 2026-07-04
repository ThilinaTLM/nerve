<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "@nervekit/ui/core/utils";

  type Props = {
    section: string;
    title: string;
    description?: string;
    muted?: boolean;
    class?: string;
    bodyClass?: string;
    actions?: Snippet;
    children: Snippet;
  };

  let {
    section,
    title,
    description,
    muted = false,
    class: className,
    bodyClass,
    actions,
    children,
  }: Props = $props();
</script>

<section
  id={`settings-${section}`}
  class={cn("settings-section-card", muted && "settings-section-card-muted", className)}
  data-section={section}
>
  <header class="settings-section-header">
    <div class="settings-section-heading">
      <h2>{title}</h2>
      {#if description}
        <p>{description}</p>
      {/if}
    </div>
    {#if actions}
      <div class="settings-section-card-actions">
        {@render actions()}
      </div>
    {/if}
  </header>

  <div class={cn("settings-section-body", bodyClass)}>
    {@render children()}
  </div>
</section>
