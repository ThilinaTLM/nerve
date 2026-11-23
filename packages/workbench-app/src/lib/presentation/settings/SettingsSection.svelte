<!--
  A settings section: the generic `PageSection` plus the settings-only bits
  (nav anchor id, info hint, layer column labels, split labels).
-->
<script lang="ts">
import type { ComponentProps, Snippet } from "svelte";
import { PageSection } from "@nervekit/ui-kit/components/composites/page";
import { settingsSectionDomId } from "./section-id";
import SettingsInfoHint from "./SettingsInfoHint.svelte";

type Props = Omit<
  ComponentProps<typeof PageSection>,
  "id" | "titleHint" | "labels" | "beforeBody"
> & {
  /** Section id from the page registry; omit for a section with no nav anchor. */
  id?: string;
  /** Longer detail shown in a tooltip beside the title. */
  info?: string;
  /**
   * Layer column labels (`ColumnLabels`) of a layered table. They sit at the
   * right of the heading/description line, or on a short line of their own
   * when the section has `actions` there.
   */
  layerLabels?: Snippet;
  /** Labels over the two halves of `LayerRow`s (`SplitColumns`), on the line above the card. */
  splitLabels?: Snippet;
};

let { id, info, layerLabels, splitLabels, ...rest }: Props = $props();
</script>

<PageSection
  {...rest}
  id={id ? settingsSectionDomId(id) : undefined}
  labels={layerLabels}
  beforeBody={splitLabels}
>
  {#snippet titleHint()}
    {#if info && rest.title}
      <SettingsInfoHint text={info} label={`About ${rest.title}`} />
    {/if}
  {/snippet}
</PageSection>
