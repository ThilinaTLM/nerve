<script lang="ts">
let {
  label,
  compact = false,
  class: className,
}: {
  label?: string;
  compact?: boolean;
  class?: string;
} = $props();
</script>

<svg
  viewBox="120 120 272 272"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  class={className}
  role={label ? "img" : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
>
  <g
    stroke="currentColor"
    stroke-width={compact ? 32 : 28}
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M150 350V162" />
    <path d="M362 350V162" />
    {#if compact}
      <path d="M150 162L232 235L258 208L284 288L362 350" />
    {:else}
      <path d="M150 162L222 226L246 194L272 300L296 262L362 350" />
    {/if}
  </g>
</svg>
