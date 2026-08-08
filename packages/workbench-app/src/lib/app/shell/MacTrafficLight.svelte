<script lang="ts">
type Props = {
  kind: "close" | "minimize" | "maximize";
  class?: string;
};

let { kind, class: className }: Props = $props();

const colors = {
  close: { border: "#e24b41", fill: "#ed6a5f", symbol: "#460804" },
  minimize: { border: "#e1a73e", fill: "#f6be50", symbol: "#90591d" },
  maximize: { border: "#2dac2f", fill: "#61c555", symbol: "#2a6218" },
} as const;
</script>

<!-- Adapted from https://github.com/lwouis/macos-traffic-light-buttons-as-SVG
     (CC0-1.0). The source artwork's fixed colors are intentional. -->
<svg
  viewBox="0 0 85.4 85.4"
  class={className}
  aria-hidden="true"
  focusable="false"
>
  <circle cx="42.7" cy="42.7" r="42.7" fill={colors[kind].border} />
  <circle cx="42.7" cy="42.7" r="39.1" fill={colors[kind].fill} />
  <g
    fill={colors[kind].symbol}
    class="opacity-0 group-hover/window-controls:opacity-100 group-focus-within/window-controls:opacity-100"
  >
    {#if kind === "close"}
      <path
        d="m22.5 57.8 35.3-35.3c1.4-1.4 3.6-1.4 5 0l.1.1c1.4 1.4 1.4 3.6 0 5L27.6 62.9c-1.4 1.4-3.6 1.4-5 0l-.1-.1c-1.3-1.4-1.3-3.6 0-5Z"
      />
      <path
        d="m27.6 22.5 35.3 35.3c1.4 1.4 1.4 3.6 0 5l-.1.1c-1.4 1.4-3.6 1.4-5 0L22.5 27.6c-1.4-1.4-1.4-3.6 0-5l.1-.1c1.4-1.3 3.6-1.3 5 0Z"
      />
    {:else if kind === "minimize"}
      <path
        d="M17.8 39.1h49.9c1.9 0 3.5 1.6 3.5 3.5v.1c0 1.9-1.6 3.5-3.5 3.5H17.8c-1.9 0-3.5-1.6-3.5-3.5v-.1c0-1.9 1.5-3.5 3.5-3.5Z"
      />
    {:else}
      <path
        d="M31.2 20.8h26.7c3.6 0 6.5 2.9 6.5 6.5V54Zm23.2 43.7H27.6c-3.6 0-6.5-2.9-6.5-6.5V31.2Z"
      />
    {/if}
  </g>
</svg>
