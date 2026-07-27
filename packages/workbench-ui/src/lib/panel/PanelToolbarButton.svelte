<script lang="ts">
import type { Component, Snippet } from "svelte";
import {
  Button,
  type ButtonVariant,
} from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  icon: Icon,
  label,
  title,
  variant = "ghost",
  active = false,
  disabled = false,
  loading = false,
  showLabel = false,
  class: className,
  badge,
  onclick,
}: {
  icon: Component;
  /** Accessible name; also the tooltip when `title` is omitted. */
  label: string;
  title?: string;
  variant?: ButtonVariant;
  active?: boolean;
  disabled?: boolean;
  /** Swaps the icon for a spinner while an action is in flight. */
  loading?: boolean;
  /** Renders the label next to the icon instead of icon-only. */
  showLabel?: boolean;
  class?: string;
  /** Trailing content such as a count badge. */
  badge?: Snippet;
  onclick?: (event: MouseEvent) => void;
} = $props();
</script>

<Button
  {variant}
  size={showLabel ? "xs" : "icon-xs"}
  class={cn("shrink-0", className)}
  ariaLabel={label}
  title={title ?? label}
  {active}
  {disabled}
  {onclick}
>
  {#if loading}
    <Spinner class="size-3" />
  {:else}
    <Icon aria-hidden="true" />
  {/if}
  {#if showLabel}<span class="truncate">{label}</span>{/if}
  {#if badge}{@render badge()}{/if}
</Button>
