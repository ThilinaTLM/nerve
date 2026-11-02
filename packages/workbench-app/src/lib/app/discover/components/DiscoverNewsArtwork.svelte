<script lang="ts">
import { colorThemeKind, colorThemeSchema } from "@nervekit/contracts/settings";
import type { DiscoverArtwork } from "../content/entries.js";

type Props = {
  artwork: DiscoverArtwork;
};

let { artwork }: Props = $props();

// Fanned swatches: tilt and lift per position, family order left to right.
const swatchPosition = [
  "-rotate-6 translate-y-1.5",
  "-rotate-3 translate-y-0.5",
  "z-10 -translate-y-1",
  "rotate-3 translate-y-0.5",
  "rotate-6 translate-y-1.5",
];
</script>

<!--
  Decorative editorial artwork: fixed 240x120 geometry by design. Colour comes
  from theme tokens only (solid tones for accents, `-subtle` / `-strong`
  recipes for halos and edges), so every theme renders it correctly.
-->
<div class="h-full w-full" aria-hidden="true">
  {#if artwork === "pull-requests"}
    <svg class="size-full" viewBox="0 0 240 120" fill="none">
      <circle cx="206" cy="30" r="34" class="fill-success-subtle" />
      <circle cx="28" cy="100" r="9" class="fill-primary-subtle" />

      <rect
        x="22"
        y="12"
        width="196"
        height="96"
        rx="7"
        class="fill-card stroke-border"
        stroke-width="2"
      />
      <!-- Merge-state header -->
      <rect x="22" y="12" width="196" height="24" rx="7" class="fill-muted" />
      <rect x="22" y="28" width="196" height="8" class="fill-muted" />
      <rect x="32" y="19" width="36" height="10" rx="5" class="fill-success" />
      <rect x="76" y="21" width="74" height="6" rx="3" class="fill-border" />

      <!-- Commits grouped by day -->
      <path d="M42 50V94" class="stroke-border" stroke-width="2" />
      <circle cx="42" cy="50" r="4" class="fill-primary" />
      <circle cx="42" cy="66" r="4" class="fill-primary" />
      <circle cx="42" cy="84" r="4" class="fill-primary-strong" />
      <rect x="52" y="47" width="46" height="6" rx="3" class="fill-border" />
      <rect x="52" y="63" width="36" height="6" rx="3" class="fill-border" />
      <rect x="52" y="81" width="42" height="6" rx="3" class="fill-border" />

      <!-- Live checks -->
      <circle cx="120" cy="50" r="5" class="fill-success" />
      <path
        d="M117.5 50 119.5 52 123 48"
        class="stroke-success-foreground"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <rect x="132" y="47" width="52" height="6" rx="3" class="fill-border" />
      <circle
        cx="120"
        cy="66"
        r="4"
        class="fill-card stroke-warning"
        stroke-width="2"
      />
      <rect x="132" y="63" width="40" height="6" rx="3" class="fill-border" />
      <circle cx="120" cy="82" r="5" class="fill-success" />
      <path
        d="M117.5 82 119.5 84 123 80"
        class="stroke-success-foreground"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <rect x="132" y="79" width="46" height="6" rx="3" class="fill-border" />

      <!-- Linked conversation -->
      <rect
        x="150"
        y="88"
        width="58"
        height="14"
        rx="7"
        class="fill-info-subtle stroke-info-strong"
      />
      <circle cx="160" cy="95" r="3.5" class="fill-info" />
      <rect x="168" y="93" width="30" height="4" rx="2" class="fill-info" />
    </svg>
  {:else if artwork === "notifications"}
    <svg class="size-full" viewBox="0 0 240 120" fill="none">
      <circle cx="58" cy="60" r="46" class="fill-primary-subtle" />
      <circle cx="216" cy="102" r="8" class="fill-info-subtle" />

      <!-- Bell -->
      <circle
        cx="58"
        cy="60"
        r="27"
        class="fill-card stroke-primary-strong"
        stroke-width="2"
      />
      <path
        d="M45 70H71L66 64V56A8 8 0 0 0 50 56V64Z"
        class="fill-primary stroke-primary"
        stroke-width="2"
        stroke-linejoin="round"
      />
      <path
        d="M54 74a4 4 0 0 0 8 0"
        class="stroke-primary"
        stroke-width="2"
        stroke-linecap="round"
      />
      <path
        d="M58 44V47"
        class="stroke-primary"
        stroke-width="2"
        stroke-linecap="round"
      />
      <circle
        cx="74"
        cy="42"
        r="7"
        class="fill-info stroke-card"
        stroke-width="2"
      />

      <!-- Popover entries -->
      <rect
        x="104"
        y="14"
        width="116"
        height="92"
        rx="7"
        class="fill-card stroke-border"
        stroke-width="2"
      />
      <rect x="114" y="23" width="40" height="6" rx="3" class="fill-border" />
      <rect x="190" y="22" width="20" height="8" rx="4" class="fill-muted" />

      <rect x="112" y="37" width="100" height="18" rx="5" class="fill-muted" />
      <circle cx="122" cy="46" r="4" class="fill-warning" />
      <rect x="132" y="43" width="52" height="6" rx="3" class="fill-border" />
      <rect x="190" y="42" width="16" height="8" rx="4" class="fill-primary" />

      <rect x="112" y="59" width="100" height="18" rx="5" class="fill-muted" />
      <circle cx="122" cy="68" r="4" class="fill-info" />
      <rect x="132" y="65" width="42" height="6" rx="3" class="fill-border" />

      <rect x="112" y="81" width="100" height="18" rx="5" class="fill-muted" />
      <circle cx="122" cy="90" r="4" class="fill-success" />
      <rect x="132" y="87" width="56" height="6" rx="3" class="fill-border" />
    </svg>
  {:else if artwork === "projects"}
    <svg class="size-full" viewBox="0 0 240 120" fill="none">
      <circle cx="176" cy="62" r="46" class="fill-primary-subtle" />
      <circle cx="30" cy="104" r="8" class="fill-warning-subtle" />

      <!-- Folder browser -->
      <rect
        x="20"
        y="12"
        width="140"
        height="96"
        rx="7"
        class="fill-card stroke-border"
        stroke-width="2"
      />
      <rect x="30" y="22" width="120" height="14" rx="7" class="fill-muted" />
      <rect x="40" y="27" width="56" height="4" rx="2" class="fill-border" />

      <g>
        <path
          d="M30 50a2 2 0 0 1 2-2h7l3 3h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H32a2 2 0 0 1-2-2Z"
          class="fill-warning"
        />
        <rect x="60" y="53" width="48" height="6" rx="3" class="fill-border" />
      </g>
      <rect
        x="26"
        y="66"
        width="128"
        height="16"
        rx="5"
        class="fill-selected"
      />
      <path
        d="M30 70a2 2 0 0 1 2-2h7l3 3h9a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H32a2 2 0 0 1-2-2Z"
        class="fill-primary"
      />
      <rect x="60" y="72" width="38" height="6" rx="3" class="fill-border" />
      <path
        d="M30 90a2 2 0 0 1 2-2h7l3 3h9a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H32a2 2 0 0 1-2-2Z"
        class="fill-warning"
      />
      <rect x="60" y="93" width="54" height="6" rx="3" class="fill-border" />

      <!-- Dragged folder and drop target -->
      <rect
        x="120"
        y="6"
        width="104"
        height="22"
        rx="6"
        class="fill-background stroke-primary"
        stroke-width="2"
        stroke-dasharray="5 4"
      />
      <path
        d="M172 12V22M167.5 18 172 22.5 176.5 18"
        class="stroke-primary"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <g transform="translate(168 54) rotate(8 30 24)">
        <path
          d="M0 8a5 5 0 0 1 5-5h16l6 7h26a5 5 0 0 1 5 5v28a5 5 0 0 1-5 5H5a5 5 0 0 1-5-5Z"
          class="fill-primary stroke-card"
          stroke-width="2"
          stroke-linejoin="round"
        />
        <rect
          x="9"
          y="26"
          width="30"
          height="5"
          rx="2.5"
          class="fill-primary-foreground"
        />
        <rect
          x="9"
          y="35"
          width="20"
          height="5"
          rx="2.5"
          class="fill-primary-strong"
        />
      </g>
    </svg>
  {:else if artwork === "quote"}
    <svg class="size-full" viewBox="0 0 240 120" fill="none">
      <circle cx="34" cy="26" r="24" class="fill-primary-subtle" />
      <circle cx="216" cy="98" r="9" class="fill-info-subtle" />

      <!-- Assistant reply with a selection -->
      <rect
        x="24"
        y="10"
        width="192"
        height="68"
        rx="7"
        class="fill-card stroke-border"
        stroke-width="2"
      />
      <rect x="36" y="20" width="120" height="5" rx="2.5" class="fill-border" />
      <rect
        x="34"
        y="29"
        width="128"
        height="11"
        rx="3"
        class="fill-primary-subtle stroke-primary-strong"
      />
      <rect
        x="38"
        y="33"
        width="108"
        height="5"
        rx="2.5"
        class="fill-primary-strong"
      />
      <rect x="36" y="46" width="152" height="5" rx="2.5" class="fill-border" />
      <rect x="36" y="56" width="88" height="5" rx="2.5" class="fill-border" />

      <!-- Floating toolbar -->
      <rect
        x="92"
        y="38"
        width="88"
        height="22"
        rx="11"
        class="fill-popover stroke-border"
        stroke-width="2"
      />
      <rect x="97" y="42" width="48" height="14" rx="7" class="fill-primary" />
      <rect
        x="107"
        y="47"
        width="28"
        height="4"
        rx="2"
        class="fill-primary-foreground"
      />
      <circle cx="162" cy="49" r="7" class="fill-muted" />
      <rect
        x="160"
        y="44"
        width="4"
        height="7"
        rx="2"
        class="fill-muted-foreground"
      />
      <path
        d="M157.5 50.5a4.5 4.5 0 0 0 9 0M162 55v2"
        class="stroke-muted-foreground"
        stroke-width="1.2"
        stroke-linecap="round"
      />

      <!-- Composer with the quote block -->
      <rect
        x="24"
        y="86"
        width="192"
        height="26"
        rx="7"
        class="fill-card stroke-border"
        stroke-width="2"
      />
      <rect x="34" y="92" width="3" height="14" rx="1.5" class="fill-primary" />
      <rect
        x="43"
        y="93"
        width="96"
        height="5"
        rx="2.5"
        class="fill-primary-strong"
      />
      <rect x="43" y="101" width="64" height="5" rx="2.5" class="fill-border" />
      <circle cx="198" cy="99" r="7" class="fill-primary" />
      <path
        d="M198 103V95M194.5 98.5 198 95 201.5 98.5"
        class="stroke-primary-foreground"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  {:else if artwork === "profiles"}
    <svg class="size-full" viewBox="0 0 240 120" fill="none">
      <circle cx="190" cy="34" r="36" class="fill-primary-subtle" />
      <circle cx="28" cy="102" r="9" class="fill-info-subtle" />

      <!-- Back card: custom profile -->
      <rect
        x="86"
        y="10"
        width="132"
        height="62"
        rx="7"
        class="fill-card stroke-border"
        stroke-width="2"
      />
      <circle cx="101" cy="25" r="5" class="fill-info" />
      <rect x="112" y="22" width="44" height="6" rx="3" class="fill-border" />

      <!-- Middle card: Planning -->
      <rect
        x="56"
        y="26"
        width="132"
        height="62"
        rx="7"
        class="fill-card stroke-border"
        stroke-width="2"
      />
      <circle cx="71" cy="41" r="5" class="fill-success" />
      <rect x="82" y="38" width="38" height="6" rx="3" class="fill-border" />

      <!-- Front card: Coding -->
      <rect
        x="26"
        y="42"
        width="132"
        height="68"
        rx="7"
        class="fill-card stroke-primary-strong"
        stroke-width="2"
      />
      <circle cx="41" cy="58" r="5" class="fill-primary" />
      <rect
        x="52"
        y="55"
        width="36"
        height="6"
        rx="3"
        class="fill-foreground"
      />
      <rect
        x="126"
        y="54"
        width="22"
        height="8"
        rx="4"
        class="fill-primary-subtle stroke-primary-strong"
      />
      <rect x="36" y="70" width="112" height="5" rx="2.5" class="fill-border" />
      <rect x="36" y="80" width="82" height="5" rx="2.5" class="fill-border" />
      <rect x="36" y="93" width="30" height="10" rx="5" class="fill-muted" />
      <rect x="70" y="93" width="24" height="10" rx="5" class="fill-muted" />
      <rect x="98" y="93" width="34" height="10" rx="5" class="fill-muted" />
    </svg>
  {:else if artwork === "themes"}
    <div class="flex size-full items-center justify-center">
      <div class="flex items-center -space-x-3">
        {#each colorThemeSchema.options as theme, index (theme)}
          <div
            data-theme-preview={theme}
            data-color-mode={colorThemeKind[theme]}
            class="flex h-20 w-14 gap-1 rounded-lg border border-border bg-background p-1.5 shadow-sm {swatchPosition[
              index
            ]}"
          >
            <span class="w-1.5 flex-none rounded-sm bg-panel"></span>
            <span class="grid min-w-0 flex-1 content-start gap-1">
              <span class="grid gap-1 rounded-md bg-card p-1 shadow-sm">
                <span class="h-1 w-full rounded-full bg-border"></span>
                <span class="h-1 w-2/3 rounded-full bg-border"></span>
              </span>
              <span class="h-2 w-2/3 rounded-md bg-primary"></span>
              <span class="h-2 w-1/2 rounded-md bg-success"></span>
              <span class="h-2 w-3/4 rounded-md bg-info"></span>
            </span>
          </div>
        {/each}
      </div>
    </div>
  {:else if artwork === "suggestions"}
    <svg class="size-full" viewBox="0 0 240 120" fill="none">
      <circle cx="40" cy="40" r="40" class="fill-primary-subtle" />
      <circle cx="214" cy="94" r="22" class="fill-success-subtle" />
      <circle cx="226" cy="18" r="7" class="fill-warning-subtle" />

      <!-- Repo state: branch glyph with ahead badge -->
      <rect
        x="20"
        y="12"
        width="62"
        height="22"
        rx="11"
        class="fill-card stroke-border"
        stroke-width="2"
      />
      <circle cx="31" cy="17" r="2.5" class="fill-primary" />
      <circle cx="31" cy="29" r="2.5" class="fill-primary" />
      <circle cx="40" cy="20" r="2.5" class="fill-primary-strong" />
      <path
        d="M31 19.5V26.5M40 22.5C40 26 31 24 31 26.5"
        class="stroke-primary-strong"
        stroke-width="1.6"
        stroke-linecap="round"
      />
      <rect x="47" y="20" width="14" height="5" rx="2.5" class="fill-border" />
      <rect x="64" y="17" width="14" height="12" rx="6" class="fill-success" />
      <path
        d="M71 26V20M68.5 22.5 71 20 73.5 22.5"
        class="stroke-success-foreground"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M82 23H96"
        class="stroke-border"
        stroke-width="2"
        stroke-dasharray="2 3"
        stroke-linecap="round"
      />

      <!-- Suggestion chips -->
      <rect
        x="20"
        y="52"
        width="62"
        height="20"
        rx="10"
        class="fill-primary-subtle stroke-primary-strong"
        stroke-width="1.5"
      />
      <circle cx="32" cy="62" r="3.5" class="fill-primary" />
      <rect
        x="40"
        y="59.5"
        width="34"
        height="5"
        rx="2.5"
        class="fill-primary"
      />

      <rect
        x="88"
        y="52"
        width="60"
        height="20"
        rx="10"
        class="fill-success-subtle stroke-success-strong"
        stroke-width="1.5"
      />
      <circle cx="100" cy="62" r="3.5" class="fill-success" />
      <rect
        x="108"
        y="59.5"
        width="32"
        height="5"
        rx="2.5"
        class="fill-success"
      />

      <rect
        x="154"
        y="52"
        width="66"
        height="20"
        rx="10"
        class="fill-warning-subtle stroke-warning-strong"
        stroke-width="1.5"
      />
      <circle cx="166" cy="62" r="4.5" class="fill-destructive" />
      <path
        d="M164.2 60.2 167.8 63.8M167.8 60.2 164.2 63.8"
        class="stroke-card"
        stroke-width="1.4"
        stroke-linecap="round"
      />
      <rect
        x="175"
        y="59.5"
        width="37"
        height="5"
        rx="2.5"
        class="fill-warning"
      />

      <!-- Composer -->
      <rect
        x="20"
        y="82"
        width="200"
        height="28"
        rx="9"
        class="fill-card stroke-border"
        stroke-width="2"
      />
      <rect x="32" y="93" width="76" height="6" rx="3" class="fill-border" />
      <circle cx="202" cy="96" r="8" class="fill-primary" />
      <path
        d="M202 100V92M198.5 95.5 202 92 205.5 95.5"
        class="stroke-primary-foreground"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  {:else if artwork === "engineering-docs"}
    <svg class="size-full" viewBox="0 0 240 120" fill="none">
      <circle cx="58" cy="60" r="46" class="fill-info-subtle" />
      <circle cx="210" cy="104" r="9" class="fill-primary-subtle" />

      <!-- Back page -->
      <rect
        x="62"
        y="10"
        width="120"
        height="100"
        rx="7"
        class="fill-muted stroke-border"
        stroke-width="2"
        transform="rotate(4 122 60)"
      />

      <!-- Document page -->
      <rect
        x="48"
        y="8"
        width="130"
        height="104"
        rx="7"
        class="fill-card stroke-border"
        stroke-width="2"
      />
      <rect
        x="60"
        y="19"
        width="62"
        height="8"
        rx="4"
        class="fill-primary-strong"
      />
      <rect x="60" y="33" width="104" height="5" rx="2.5" class="fill-border" />
      <rect x="60" y="43" width="92" height="5" rx="2.5" class="fill-border" />

      <!-- Architecture diagram -->
      <rect x="60" y="55" width="106" height="40" rx="5" class="fill-muted" />
      <path
        d="M85 68H98M128 68H141M113 74V82M113 82H80V76M113 82H146V76"
        class="stroke-border"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <rect x="68" y="62" width="17" height="12" rx="3" class="fill-primary" />
      <rect x="98" y="62" width="30" height="12" rx="3" class="fill-info" />
      <rect x="141" y="62" width="17" height="12" rx="3" class="fill-primary" />
      <rect
        x="70"
        y="76"
        width="20"
        height="12"
        rx="3"
        class="fill-card stroke-border"
        stroke-width="1.5"
      />
      <rect
        x="136"
        y="76"
        width="20"
        height="12"
        rx="3"
        class="fill-card stroke-border"
        stroke-width="1.5"
      />

      <rect x="60" y="100" width="70" height="4" rx="2" class="fill-border" />

      <!-- Skill badge -->
      <rect
        x="170"
        y="22"
        width="48"
        height="20"
        rx="10"
        class="fill-primary-subtle stroke-primary-strong"
        stroke-width="1.5"
      />
      <path
        d="M182 27 183.8 31.2 188 33 183.8 34.8 182 39 180.2 34.8 176 33 180.2 31.2Z"
        class="fill-primary"
      />
      <rect
        x="192"
        y="30"
        width="19"
        height="5"
        rx="2.5"
        class="fill-primary-strong"
      />

      <!-- Validated seal -->
      <circle
        cx="182"
        cy="86"
        r="19"
        class="fill-success stroke-card"
        stroke-width="3"
      />
      <circle
        cx="182"
        cy="86"
        r="13"
        class="stroke-success-foreground"
        stroke-width="1.5"
        stroke-dasharray="2 3"
      />
      <path
        d="M175.5 86.5 180.5 91.5 189 81"
        class="stroke-success-foreground"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  {:else if artwork === "mobile"}
    <svg class="size-full" viewBox="0 0 240 120" fill="none">
      <circle cx="120" cy="60" r="52" class="fill-primary-subtle" />
      <circle cx="30" cy="96" r="9" class="fill-info-subtle" />
      <circle cx="214" cy="22" r="7" class="fill-success-subtle" />

      <!-- Peeking list screen -->
      <g transform="rotate(8 150 60)">
        <rect
          x="124"
          y="10"
          width="58"
          height="104"
          rx="9"
          class="fill-muted stroke-border"
          stroke-width="2"
        />
        <rect
          x="132"
          y="24"
          width="30"
          height="5"
          rx="2.5"
          class="fill-border"
        />
        <rect x="132" y="38" width="42" height="12" rx="4" class="fill-card" />
        <rect x="132" y="55" width="42" height="12" rx="4" class="fill-card" />
        <rect x="132" y="72" width="42" height="12" rx="4" class="fill-card" />
        <circle cx="138" cy="44" r="2.5" class="fill-success" />
        <circle cx="138" cy="61" r="2.5" class="fill-info" />
        <circle cx="138" cy="78" r="2.5" class="fill-warning" />
      </g>

      <!-- Front phone -->
      <rect
        x="72"
        y="4"
        width="76"
        height="112"
        rx="12"
        class="fill-card stroke-primary-strong"
        stroke-width="2.5"
      />
      <rect x="100" y="8" width="20" height="5" rx="2.5" class="fill-border" />

      <!-- Segmented control -->
      <rect x="79" y="19" width="62" height="12" rx="6" class="fill-muted" />
      <rect
        x="80.5"
        y="20.5"
        width="15"
        height="9"
        rx="4.5"
        class="fill-primary"
      />
      <rect x="99" y="23.5" width="9" height="3" rx="1.5" class="fill-border" />
      <rect
        x="112"
        y="23.5"
        width="9"
        height="3"
        rx="1.5"
        class="fill-border"
      />
      <rect
        x="125"
        y="23.5"
        width="10"
        height="3"
        rx="1.5"
        class="fill-border"
      />

      <!-- Chat -->
      <rect x="79" y="38" width="42" height="14" rx="6" class="fill-muted" />
      <rect x="84" y="43" width="26" height="4" rx="2" class="fill-border" />
      <rect x="95" y="57" width="46" height="14" rx="6" class="fill-primary" />
      <rect
        x="100"
        y="62"
        width="28"
        height="4"
        rx="2"
        class="fill-primary-foreground"
      />
      <rect x="79" y="76" width="50" height="14" rx="6" class="fill-muted" />
      <rect x="84" y="81" width="32" height="4" rx="2" class="fill-border" />

      <!-- Docked composer -->
      <rect
        x="77"
        y="94"
        width="66"
        height="14"
        rx="7"
        class="fill-muted stroke-border"
        stroke-width="1.5"
      />
      <rect x="83" y="99" width="26" height="4" rx="2" class="fill-border" />
      <circle cx="135" cy="101" r="5" class="fill-primary" />
      <path
        d="M135 103.5V98.5M132.8 100.5 135 98.5 137.2 100.5"
        class="stroke-primary-foreground"
        stroke-width="1.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <rect
        x="100"
        y="111"
        width="20"
        height="2.5"
        rx="1.25"
        class="fill-border"
      />
    </svg>
  {:else if artwork === "git-actions"}
    <svg class="size-full" viewBox="0 0 240 120" fill="none">
      <circle cx="198" cy="40" r="42" class="fill-primary-subtle" />
      <circle cx="26" cy="102" r="9" class="fill-success-subtle" />
      <circle cx="224" cy="108" r="6" class="fill-warning-subtle" />

      <!-- Repository row -->
      <rect
        x="14"
        y="26"
        width="212"
        height="42"
        rx="9"
        class="fill-card stroke-border"
        stroke-width="2"
      />
      <circle cx="32" cy="38" r="3" class="fill-primary" />
      <circle cx="32" cy="58" r="3" class="fill-primary" />
      <circle cx="43" cy="42" r="3" class="fill-primary-strong" />
      <path
        d="M32 41V55M43 45C43 51 32 49 32 55"
        class="stroke-primary-strong"
        stroke-width="2"
        stroke-linecap="round"
      />
      <rect x="54" y="35" width="48" height="7" rx="3.5" class="fill-border" />
      <rect x="54" y="48" width="30" height="5" rx="2.5" class="fill-muted" />

      <!-- Ahead / behind -->
      <rect
        x="108"
        y="36"
        width="22"
        height="12"
        rx="6"
        class="fill-success-subtle"
      />
      <path
        d="M114 44V40M112 42 114 40 116 42"
        class="stroke-success-strong"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <rect
        x="119"
        y="40.5"
        width="7"
        height="3"
        rx="1.5"
        class="fill-success"
      />
      <rect
        x="108"
        y="52"
        width="22"
        height="12"
        rx="6"
        class="fill-warning-subtle"
      />
      <path
        d="M114 54V58M112 56 114 58 116 56"
        class="stroke-warning-strong"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <rect
        x="119"
        y="56.5"
        width="7"
        height="3"
        rx="1.5"
        class="fill-warning"
      />

      <!-- Action cluster -->
      <rect x="140" y="35" width="26" height="24" rx="7" class="fill-primary" />
      <path
        d="M153 52V42M148.5 46.5 153 42 157.5 46.5"
        class="stroke-primary-foreground"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <rect
        x="171"
        y="35"
        width="24"
        height="24"
        rx="7"
        class="fill-muted stroke-border"
        stroke-width="1.5"
      />
      <rect
        x="177"
        y="43"
        width="12"
        height="10"
        rx="2"
        class="fill-card stroke-muted-foreground"
        stroke-width="1.5"
      />
      <path
        d="M180 47H186"
        class="stroke-muted-foreground"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <rect
        x="200"
        y="35"
        width="20"
        height="24"
        rx="7"
        class="fill-muted stroke-border"
        stroke-width="1.5"
      />
      <path
        d="M205 47H215M211.5 43.5 215 47 211.5 50.5"
        class="stroke-muted-foreground"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      <!-- Menu hint -->
      <path
        d="M153 64V70"
        class="stroke-primary-strong"
        stroke-width="2"
        stroke-linecap="round"
      />
      <rect
        x="104"
        y="72"
        width="112"
        height="40"
        rx="7"
        class="fill-popover stroke-border"
        stroke-width="2"
      />
      <rect
        x="110"
        y="77"
        width="100"
        height="14"
        rx="4"
        class="fill-selected"
      />
      <circle cx="119" cy="84" r="3.5" class="fill-primary" />
      <rect
        x="127"
        y="81.5"
        width="46"
        height="5"
        rx="2.5"
        class="fill-border"
      />
      <circle cx="119" cy="100" r="3.5" class="fill-info" />
      <rect
        x="127"
        y="97.5"
        width="36"
        height="5"
        rx="2.5"
        class="fill-border"
      />
    </svg>
  {:else}
    <svg class="size-full" viewBox="0 0 240 120" fill="none">
      <circle cx="194" cy="25" r="13" class="fill-success-subtle" />
      <circle cx="33" cy="95" r="10" class="fill-info-subtle" />

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
      <circle cx="32" cy="25" r="3" class="fill-destructive" />
      <circle cx="42" cy="25" r="3" class="fill-warning" />
      <circle cx="52" cy="25" r="3" class="fill-success" />

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

      <rect x="35" y="50" width="27" height="5" rx="2.5" class="fill-border" />
      <rect
        x="35"
        y="62"
        width="21"
        height="5"
        rx="2.5"
        class="fill-primary-strong"
      />
      <rect x="35" y="74" width="25" height="5" rx="2.5" class="fill-border" />

      <circle cx="89" cy="56" r="4" class="fill-info" />
      <rect x="98" y="52" width="56" height="7" rx="3.5" class="fill-muted" />
      <circle cx="89" cy="70" r="4" class="fill-success" />
      <rect x="98" y="66" width="43" height="7" rx="3.5" class="fill-muted" />
      <path
        d="M89 82H152"
        class="stroke-primary-strong"
        stroke-width="5"
        stroke-linecap="round"
      />

      <rect
        x="183"
        y="50"
        width="22"
        height="16"
        rx="3"
        class="fill-primary-subtle"
      />
      <rect x="183" y="72" width="22" height="7" rx="3.5" class="fill-border" />
      <rect x="183" y="85" width="16" height="7" rx="3.5" class="fill-border" />
    </svg>
  {/if}
</div>
