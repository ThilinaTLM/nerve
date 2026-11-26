<!--
  What an installed extension adds and where it comes from, below its settings:
  the plain-language consent summary (Adds), its folder, versions and consent
  state with Review and Revoke (Source), and the host's diagnostics.
-->
<script lang="ts">
import {
  FieldRow,
  PageItem,
  PageList,
} from "@nervekit/ui-kit/components/composites/page";
import Globe from "@lucide/svelte/icons/globe";
import Layers from "@lucide/svelte/icons/layers";
import Puzzle from "@lucide/svelte/icons/puzzle";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import User from "@lucide/svelte/icons/user";
import Wrench from "@lucide/svelte/icons/wrench";
import Zap from "@lucide/svelte/icons/zap";
import type {
  ExtensionCatalogEntry,
  ExtensionConsentItem,
} from "@nervekit/contracts/extensions";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ScopedExtensionsState } from "$lib/application/extensions/scoped-extensions-state.svelte";
import { SettingsSection } from "$lib/presentation/settings";
import { openConfigurationReview } from "$lib/application/configuration-review/configuration-review-queue.svelte";
import { useItemReview } from "../review/item-review.svelte";
import { consentState, installedSourceRows } from "./extensions-view";

type Props = {
  entry: ExtensionCatalogEntry;
  extensions: ScopedExtensionsState;
};

let { entry, extensions }: Props = $props();

const icons: Record<ExtensionConsentItem["kind"], typeof Puzzle> = {
  network: Globe,
  account: User,
  model: Zap,
  frame: Zap,
  tools: Wrench,
  namespace: Zap,
  ui: Layers,
  code: Puzzle,
};
const adds = $derived(entry.adds ?? []);
const rows = $derived(installedSourceRows(entry));
// A declined extension says so; reviewing it is still how it is allowed.
const consent = $derived(
  entry.state === "pending_consent" && entry.trustState === "declined"
    ? {
        ...consentState(entry),
        label: "Declined",
        description: "Nothing runs until you review and trust it.",
      }
    : consentState(entry),
);
const reviewTarget = $derived(extensions.reviewTarget(entry));
// Revoke declines exactly the version its review read.
const trusted = useItemReview(() =>
  consent.canRevoke ? reviewTarget : undefined,
);
</script>

{#each entry.diagnostics as diagnostic (diagnostic.message)}
  <Callout
    layout="block"
    tone={diagnostic.level === "error" ? "destructive" : "warning"}
    text={diagnostic.message}
  />
{/each}

{#if adds.length > 0}
  <SettingsSection
    id="adds"
    title="Adds"
    description="What this extension adds to Nerve and what it can reach."
  >
    <PageList ariaLabel="What this extension adds">
      {#each adds as item (item.text)}
        <PageItem
          title={item.text}
          icon={item.broad ? TriangleAlert : icons[item.kind]}
          compact
        />
      {/each}
    </PageList>
  </SettingsSection>
{/if}

<SettingsSection id="source" title="Source" divided>
  {#each rows as row (row.label)}
    <FieldRow label={row.label}>
      {#snippet control()}
        <span
          class={row.mono
            ? "min-w-0 break-all font-mono text-caption text-muted-foreground"
            : "text-ui text-muted-foreground"}>{row.value}</span
        >
      {/snippet}
    </FieldRow>
  {/each}
  <FieldRow label="Trust" description={consent.description}>
    {#snippet control()}
      <div class="flex flex-wrap items-center justify-end gap-2">
        <span class="text-ui text-foreground">{consent.label}</span>
        {#if consent.canReview && reviewTarget}
          <Button
            size="sm"
            variant="outline"
            onclick={() => openConfigurationReview([reviewTarget])}
            >Review</Button
          >
        {/if}
        {#if consent.canRevoke && trusted.current}
          <Button
            size="sm"
            variant="outline"
            disabled={trusted.current.busy || !trusted.current.review}
            onclick={() => void trusted.current?.decline()}>Revoke</Button
          >
        {/if}
      </div>
    {/snippet}
  </FieldRow>
</SettingsSection>
