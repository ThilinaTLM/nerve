<script lang="ts">
import Boxes from "@lucide/svelte/icons/boxes";
import Cpu from "@lucide/svelte/icons/cpu";
import Sparkles from "@lucide/svelte/icons/sparkles";
import type { Component } from "svelte";
import { tick } from "svelte";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { authState } from "$lib/features/auth/state/auth-state.svelte";
import { loadAuthPanel } from "$lib/features/auth/state/auth.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import ApiKeysSection from "./ApiKeysSection.svelte";
import CustomProvidersSection from "./CustomProvidersSection.svelte";
import ModelsSection from "./ModelsSection.svelte";
import SubscriptionsSection from "./SubscriptionsSection.svelte";

type SectionId =
  | "subscriptions"
  | "api-keys"
  | "custom-providers"
  | "custom-models";
type GroupId = "connections" | "custom-providers" | "custom-models";
type GroupSection = { id: SectionId; label: string };
type AuthGroup = {
  id: GroupId;
  label: string;
  icon: Component;
  sections: GroupSection[];
};

const groups: AuthGroup[] = [
  {
    id: "connections",
    label: "Connections",
    icon: Sparkles,
    sections: [
      { id: "subscriptions", label: "Subscriptions" },
      { id: "api-keys", label: "API keys" },
    ],
  },
  {
    id: "custom-providers",
    label: "Custom Providers",
    icon: Boxes,
    sections: [{ id: "custom-providers", label: "Custom Providers" }],
  },
  {
    id: "custom-models",
    label: "Custom Models",
    icon: Cpu,
    sections: [{ id: "custom-models", label: "Custom Models" }],
  },
];

const authProviders = $derived(settingsState.authProviders);
const models = $derived(settingsState.models);

let activeGroup = $state<GroupId>("connections");
let activeSubsection = $state<SectionId>("subscriptions");

const activeGroupDef = $derived(
  groups.find((group) => group.id === activeGroup) ?? groups[0],
);

if (!authState.catalogLoaded) void loadAuthPanel();

function selectGroup(id: GroupId) {
  if (id === activeGroup) return;
  activeGroup = id;
  const first = groups.find((group) => group.id === id)?.sections[0];
  if (first) activeSubsection = first.id;
  void scrollPanelToTop();
}

async function scrollPanelToTop() {
  await tick();
  document.querySelector(".settings-viewport")?.scrollTo({ top: 0 });
}

function scrollToSubsection(id: SectionId) {
  activeSubsection = id;
  document
    .getElementById(`auth-${id}`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Scroll-spy: highlight the sub-nav chip matching the section in view.
$effect(() => {
  const group = activeGroupDef;

  let observer: IntersectionObserver | undefined;
  let cancelled = false;

  void (async () => {
    await tick();
    if (cancelled) return;
    const root = document.querySelector<HTMLElement>(".settings-viewport");
    const elements = group.sections
      .map((section) => document.getElementById(`auth-${section.id}`))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = visible[0]?.target.getAttribute("data-section");
        if (id) activeSubsection = id as SectionId;
      },
      { root, rootMargin: "0px 0px -65% 0px", threshold: 0 },
    );
    for (const element of elements) observer.observe(element);
  })();

  return () => {
    cancelled = true;
    observer?.disconnect();
  };
});
</script>

<section class="settings-page">
  <aside class="settings-sidebar" aria-label="Authentication sections">
    <div class="settings-sidebar-title">
      <strong>Authentication</strong>
    </div>
    <nav class="settings-nav">
      {#each groups as group (group.id)}
        {@const Icon = group.icon}
        <button
          type="button"
          class:active={activeGroup === group.id}
          aria-current={activeGroup === group.id ? "page" : undefined}
          onclick={() => selectGroup(group.id)}
        >
          <Icon size={16} strokeWidth={2} />
          <span>{group.label}</span>
        </button>
      {/each}
    </nav>
  </aside>

  <ScrollArea
    class="settings-scroll"
    viewportClass="settings-viewport"
    type="auto"
  >
    <div class="settings-main">
      <header class="settings-panel-header">
        <h2>{activeGroupDef.label}</h2>
        {#if activeGroupDef.sections.length > 1}
          <div
            class="settings-subnav"
            role="tablist"
            aria-label="{activeGroupDef.label} sections"
          >
            {#each activeGroupDef.sections as section (section.id)}
              <button
                type="button"
                role="tab"
                aria-selected={activeSubsection === section.id}
                class:active={activeSubsection === section.id}
                onclick={() => scrollToSubsection(section.id)}
              >
                {section.label}
              </button>
            {/each}
          </div>
        {/if}
      </header>

      {#if activeGroup === "connections"}
        <SubscriptionsSection {authProviders} />
        <ApiKeysSection {authProviders} />
      {:else if activeGroup === "custom-providers"}
        <CustomProvidersSection {authProviders} />
      {:else if activeGroup === "custom-models"}
        <ModelsSection {models} {authProviders} />
      {/if}
    </div>
  </ScrollArea>
</section>
