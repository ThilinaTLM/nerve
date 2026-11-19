<script lang="ts" module>
/** Gear outline centred on (cx, cy), with flat-topped teeth. */
function gear(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  teeth: number,
) {
  const step = (Math.PI * 2) / teeth;
  const points = Array.from({ length: teeth }, (_, i) =>
    (
      [
        [-0.3, inner],
        [-0.16, outer],
        [0.16, outer],
        [0.3, inner],
      ] as const
    ).map(([offset, r]) => {
      const t = (i + offset) * step;
      return `${(cx + r * Math.cos(t)).toFixed(1)} ${(cy + r * Math.sin(t)).toFixed(1)}`;
    }),
  ).flat();
  return `M${points.join("L")}Z`;
}

const largeGear = gear(66, 52, 25, 19, 10);
const smallGear = gear(98, 36, 15, 11, 8);
</script>

<script lang="ts">
import type { ConversationStarter } from "./conversation-starters";

let {
  profile,
  class: className,
}: { profile: ConversationStarter["profile"]; class?: string } = $props();
</script>

<svg
  viewBox="24 0 112 96"
  fill="none"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  aria-hidden="true"
>
  {#if profile === "coding"}
    <rect
      x="38"
      y="18"
      width="84"
      height="60"
      rx="6"
      transform="rotate(6 80 48)"
      class="fill-muted stroke-border"
    />
    <rect
      x="38"
      y="18"
      width="84"
      height="60"
      rx="6"
      transform="rotate(-3 80 48)"
      class="fill-card stroke-border"
    />
    <g transform="rotate(-3 80 48)">
      <rect x="48" y="30" width="28" height="5" rx="2.5" class="fill-border" />
      <rect x="56" y="41" width="42" height="5" rx="2.5" class="fill-primary" />
      <rect x="56" y="52" width="32" height="5" rx="2.5" class="fill-border" />
      <rect x="48" y="63" width="18" height="5" rx="2.5" class="fill-border" />
    </g>
  {:else if profile === "planning"}
    <rect
      x="38"
      y="16"
      width="84"
      height="64"
      rx="6"
      transform="rotate(5 80 48)"
      class="fill-muted stroke-border"
    />
    <rect
      x="38"
      y="16"
      width="84"
      height="64"
      rx="6"
      class="fill-card stroke-border"
    />
    <path
      d="M38 32H122M38 48H122M38 64H122M59 16V80M80 16V80M101 16V80"
      class="stroke-border-subtle"
    />
    <path
      d="M48 69L69 56L91 60L112 27"
      class="stroke-primary"
      stroke-width="2.5"
    />
    <circle cx="48" cy="69" r="4" class="fill-primary" />
    <circle cx="69" cy="56" r="4" class="fill-primary" />
    <circle
      cx="91"
      cy="60"
      r="4"
      class="fill-card stroke-primary"
      stroke-width="2"
    />
    <circle
      cx="112"
      cy="27"
      r="4"
      class="fill-card stroke-primary"
      stroke-width="2"
    />
  {:else if profile === "lead"}
    <circle cx="80" cy="48" r="38" class="stroke-border-subtle" />
    <circle cx="80" cy="48" r="24" class="stroke-border" />
    <circle cx="80" cy="48" r="12" class="fill-primary" />
    <circle cx="104" cy="48" r="6" class="fill-card stroke-border" />
    <circle cx="63" cy="31" r="6" class="fill-card stroke-border" />
    <circle
      cx="49"
      cy="70"
      r="6"
      class="fill-primary-subtle stroke-primary-strong"
    />
    <circle cx="115" cy="27" r="6" class="fill-card stroke-border" />
  {:else}
    <path d={largeGear} class="fill-muted stroke-border" stroke-width="1.5" />
    <circle cx="66" cy="52" r="7" class="fill-card stroke-border" />
    <path
      d={smallGear}
      class="fill-primary stroke-primary"
      stroke-width="1.5"
    />
    <circle cx="98" cy="36" r="4.5" class="fill-card" />
    <path
      d="M118 62L120 68L126 70L120 72L118 78L116 72L110 70L116 68Z"
      class="fill-primary"
    />
  {/if}
</svg>
