<script lang="ts">
import type { DiscoverNewsArtwork } from "../catalog.js";

type Props = {
  artwork: DiscoverNewsArtwork;
};

let { artwork }: Props = $props();
</script>

<!-- Decorative editorial artwork uses fixed viewBox geometry by design. -->
<div class="h-full w-full" aria-hidden="true">
  {#if artwork === "discover"}
    <svg class="size-full" viewBox="0 0 240 120" fill="none">
      <circle cx="174" cy="56" r="50" class="fill-primary/8" />
      <circle cx="205" cy="25" r="9" class="fill-info/15" />
      <circle cx="120" cy="101" r="7" class="fill-warning/20" />

      <rect
        x="28"
        y="28"
        width="112"
        height="70"
        rx="6"
        class="fill-card stroke-border"
        stroke-width="2"
      />
      <rect
        x="40"
        y="40"
        width="62"
        height="6"
        rx="3"
        class="fill-muted-foreground/25"
      />
      <rect x="40" y="54" width="86" height="5" rx="2.5" class="fill-muted" />
      <rect x="40" y="65" width="72" height="5" rx="2.5" class="fill-muted" />
      <rect
        x="40"
        y="80"
        width="34"
        height="8"
        rx="4"
        class="fill-primary/20"
      />

      <g transform="translate(132 19) rotate(7 41 41)">
        <rect
          x="0"
          y="0"
          width="82"
          height="82"
          rx="8"
          class="fill-background stroke-border"
          stroke-width="2"
        />
        <circle
          cx="41"
          cy="39"
          r="23"
          class="fill-primary/8 stroke-primary/50"
          stroke-width="2"
        />
        <path
          d="M48 30 43 43 30 48 35 35 48 30Z"
          class="fill-primary stroke-primary"
          stroke-linejoin="round"
        />
        <circle cx="39" cy="39" r="3" class="fill-primary-foreground" />
        <path
          d="M24 67H58"
          class="stroke-muted-foreground/30"
          stroke-width="4"
          stroke-linecap="round"
        />
      </g>
    </svg>
  {:else if artwork === "workbench"}
    <svg class="size-full" viewBox="0 0 240 120" fill="none">
      <circle cx="194" cy="25" r="13" class="fill-success/12" />
      <circle cx="33" cy="95" r="10" class="fill-info/12" />

      <rect
        x="20"
        y="15"
        width="200"
        height="92"
        rx="7"
        class="fill-card stroke-border"
        stroke-width="2"
      />
      <path d="M20 34H220" class="stroke-border" stroke-width="2" />
      <circle cx="32" cy="25" r="3" class="fill-destructive/45" />
      <circle cx="42" cy="25" r="3" class="fill-warning/55" />
      <circle cx="52" cy="25" r="3" class="fill-success/55" />

      <rect x="29" y="43" width="40" height="55" rx="4" class="fill-muted" />
      <rect
        x="77"
        y="43"
        width="92"
        height="55"
        rx="4"
        class="fill-background stroke-border"
      />
      <rect x="177" y="43" width="34" height="55" rx="4" class="fill-muted" />

      <rect
        x="35"
        y="50"
        width="27"
        height="5"
        rx="2.5"
        class="fill-muted-foreground/25"
      />
      <rect
        x="35"
        y="62"
        width="21"
        height="5"
        rx="2.5"
        class="fill-primary/25"
      />
      <rect
        x="35"
        y="74"
        width="25"
        height="5"
        rx="2.5"
        class="fill-muted-foreground/20"
      />

      <circle cx="89" cy="56" r="4" class="fill-info/45" />
      <rect x="98" y="52" width="56" height="7" rx="3.5" class="fill-muted" />
      <circle cx="89" cy="70" r="4" class="fill-success/50" />
      <rect x="98" y="66" width="43" height="7" rx="3.5" class="fill-muted" />
      <path
        d="M89 82H152"
        class="stroke-primary/40"
        stroke-width="5"
        stroke-linecap="round"
      />

      <rect
        x="183"
        y="50"
        width="22"
        height="16"
        rx="3"
        class="fill-primary/15"
      />
      <rect
        x="183"
        y="72"
        width="22"
        height="7"
        rx="3.5"
        class="fill-muted-foreground/20"
      />
      <rect
        x="183"
        y="85"
        width="16"
        height="7"
        rx="3.5"
        class="fill-muted-foreground/20"
      />
    </svg>
  {:else}
    <svg class="size-full" viewBox="0 0 240 120" fill="none">
      <circle cx="194" cy="95" r="15" class="fill-info/12" />
      <circle cx="39" cy="20" r="10" class="fill-primary/10" />

      <rect
        x="34"
        y="10"
        width="172"
        height="100"
        rx="7"
        class="fill-card stroke-border"
        stroke-width="2"
      />
      <path d="M34 31H206" class="stroke-border" />
      <path
        d="M46 20H76"
        class="stroke-muted-foreground/35"
        stroke-width="5"
        stroke-linecap="round"
      />
      <circle
        cx="191"
        cy="20"
        r="5"
        class="fill-primary/15 stroke-primary/50"
      />
      <path
        d="M191 12V15M191 25V28M183 20H186M196 20H199"
        class="stroke-primary/60"
        stroke-width="2"
        stroke-linecap="round"
      />

      <path
        d="M46 41H80"
        class="stroke-foreground/55"
        stroke-width="4"
        stroke-linecap="round"
      />
      <rect x="45" y="49" width="150" height="18" rx="5" class="fill-muted" />
      <circle cx="55" cy="58" r="4" class="fill-primary/65" />
      <path
        d="M65 58H126"
        class="stroke-muted-foreground/45"
        stroke-width="4"
        stroke-linecap="round"
      />
      <path
        d="M46 76H68"
        class="stroke-foreground/55"
        stroke-width="4"
        stroke-linecap="round"
      />
      <rect x="45" y="84" width="150" height="18" rx="5" class="fill-muted" />
      <circle
        cx="55"
        cy="93"
        r="4"
        class="fill-background stroke-success/70"
        stroke-width="2"
      />
      <path
        d="M65 93H148"
        class="stroke-muted-foreground/45"
        stroke-width="4"
        stroke-linecap="round"
      />
      <path
        d="M178 89V97M174 93H182"
        class="stroke-success/70"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
  {/if}
</div>
