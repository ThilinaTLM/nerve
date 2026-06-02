<script lang="ts">
  import { cn } from "../../utils/cn";

  export type StatusTone = "neutral" | "accent" | "good" | "warn" | "danger" | "running";

  type Props = {
    tone?: StatusTone;
    size?: "xs" | "sm" | "md";
    pulse?: boolean;
    label?: string;
    class?: string;
  };

  let {
    tone = "neutral",
    size = "sm",
    pulse = false,
    label,
    class: className = "",
  }: Props = $props();
</script>

<span class={cn("status-dot", tone, size, pulse && "pulse", className)} aria-label={label} aria-hidden={label ? undefined : "true"}></span>

<style>
  .status-dot {
    display: inline-block;
    flex: none;
    border-radius: 999px;
    background: var(--color-faint);
    box-shadow: 0 0 0 1px rgb(255 255 255 / 8%);
  }

  .xs {
    width: 0.42rem;
    height: 0.42rem;
  }

  .sm {
    width: 0.5rem;
    height: 0.5rem;
  }

  .md {
    width: 0.62rem;
    height: 0.62rem;
  }

  .accent,
  .running {
    background: var(--color-accent);
  }

  .good {
    background: var(--color-good);
  }

  .warn {
    background: var(--color-warn);
  }

  .danger {
    background: var(--color-danger);
  }

  .pulse {
    animation: status-pulse 1.4s ease-in-out infinite;
  }

  @keyframes status-pulse {
    0%, 100% { box-shadow: 0 0 0 1px var(--color-accent-muted), 0 0 0 4px rgb(204 255 128 / 8%); }
    50% { box-shadow: 0 0 0 1px var(--color-accent), 0 0 0 7px rgb(204 255 128 / 16%); }
  }
</style>
