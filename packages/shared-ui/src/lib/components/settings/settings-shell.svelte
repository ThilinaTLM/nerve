<script lang="ts" module>
  import type { Component } from "svelte";

  export type SettingsShellSection = {
    id: string;
    label: string;
  };

  export type SettingsShellGroup = {
    id: string;
    label: string;
    description?: string;
    icon?: Component;
    sections?: SettingsShellSection[];
  };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { tick } from "svelte";
  import { ScrollArea } from "@nervekit/shared-ui/components/ui/scroll-area";
  import { cn } from "@nervekit/shared-ui/core/utils";

  type Props = {
    groups: SettingsShellGroup[];
    activeGroupId?: string;
    activeSectionId?: string;
    title?: string;
    ariaLabel?: string;
    sectionIdPrefix?: string;
    showPanelHeader?: boolean;
    scrollSpy?: boolean;
    class?: string;
    mainClass?: string;
    sidebarFooter?: Snippet;
    panelActions?: Snippet<[SettingsShellGroup]>;
    navMeta?: Snippet<[SettingsShellGroup]>;
    children: Snippet<[SettingsShellGroup]>;
    onGroupChange?: (id: string) => void;
    onSectionChange?: (id: string) => void;
  };

  let {
    groups,
    activeGroupId = $bindable(groups[0]?.id ?? ""),
    activeSectionId = $bindable(groups[0]?.sections?.[0]?.id ?? ""),
    title = "Settings",
    ariaLabel = "Settings sections",
    sectionIdPrefix = "settings",
    showPanelHeader = true,
    scrollSpy = true,
    class: className,
    mainClass,
    sidebarFooter,
    panelActions,
    navMeta,
    children,
    onGroupChange,
    onSectionChange,
  }: Props = $props();

  let viewportElement = $state<HTMLElement | null>(null);

  const activeGroup = $derived(
    groups.find((group) => group.id === activeGroupId) ?? groups[0],
  );
  const activeSections = $derived(activeGroup?.sections ?? []);

  $effect(() => {
    if (groups.length === 0) return;
    if (groups.some((group) => group.id === activeGroupId)) return;

    const next = groups[0];
    activeGroupId = next.id;
    activeSectionId = next.sections?.[0]?.id ?? activeSectionId;
  });

  $effect(() => {
    if (activeSections.length === 0) return;
    if (activeSections.some((section) => section.id === activeSectionId)) return;
    activeSectionId = activeSections[0].id;
  });

  function sectionElementId(id: string): string {
    return `${sectionIdPrefix}-${id}`;
  }

  function sectionSelector(id: string): string {
    return `[data-section="${id.replace(/"/g, '\\"')}"]`;
  }

  async function scrollPanelToTop(): Promise<void> {
    await tick();
    viewportElement?.scrollTo({ top: 0 });
  }

  function selectGroup(id: string): void {
    if (id === activeGroupId) return;

    const next = groups.find((group) => group.id === id) ?? groups[0];
    activeGroupId = next.id;
    activeSectionId = next.sections?.[0]?.id ?? activeSectionId;
    onGroupChange?.(next.id);
    void scrollPanelToTop();
  }

  function selectSection(id: string): void {
    activeSectionId = id;
    onSectionChange?.(id);
    const target =
      viewportElement?.querySelector<HTMLElement>(sectionSelector(id)) ??
      document.getElementById(sectionElementId(id));
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $effect(() => {
    const root = viewportElement;
    const sections = activeSections;
    if (!scrollSpy || !root || sections.length === 0) return;

    let observer: IntersectionObserver | undefined;
    let cancelled = false;

    void (async () => {
      await tick();
      if (cancelled) return;

      const elements = sections
        .map(
          (section) =>
            root.querySelector<HTMLElement>(sectionSelector(section.id)) ??
            document.getElementById(sectionElementId(section.id)),
        )
        .filter((element): element is HTMLElement => element !== null);
      if (elements.length === 0) return;

      observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort(
              (left, right) =>
                left.boundingClientRect.top - right.boundingClientRect.top,
            );
          const id = visible[0]?.target.getAttribute("data-section");
          if (!id || id === activeSectionId) return;
          activeSectionId = id;
          onSectionChange?.(id);
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

<section class={cn("settings-page", className)}>
  <aside class="settings-sidebar" aria-label={ariaLabel}>
    <div class="settings-sidebar-title">
      <strong>{title}</strong>
    </div>

    <nav class="settings-nav">
      {#each groups as group (group.id)}
        {@const Icon = group.icon}
        {@const active = activeGroup?.id === group.id}
        <button
          type="button"
          class:active
          aria-current={active ? "page" : undefined}
          onclick={() => selectGroup(group.id)}
        >
          {#if Icon}
            <Icon size={16} strokeWidth={2} />
          {/if}
          <span class="settings-nav-label">{group.label}</span>
          {#if navMeta}
            <span class="settings-nav-meta">
              {@render navMeta(group)}
            </span>
          {/if}
        </button>
      {/each}
    </nav>

    {#if sidebarFooter}
      {@render sidebarFooter()}
    {/if}
  </aside>

  <ScrollArea
    class="settings-scroll"
    bind:viewportRef={viewportElement}
    viewportClass="settings-viewport"
    type="auto"
  >
    <div class={cn("settings-main", mainClass)}>
      {#if activeGroup}
        {#if showPanelHeader}
          <header class="settings-panel-header">
            <div class="settings-panel-title-row">
              <div class="settings-panel-title-copy">
                <h2>{activeGroup.label}</h2>
                {#if activeGroup.description}
                  <p>{activeGroup.description}</p>
                {/if}
              </div>
              {#if panelActions}
                <div class="settings-panel-actions">
                  {@render panelActions(activeGroup)}
                </div>
              {/if}
            </div>

            {#if activeSections.length > 1}
              <div
                class="settings-subnav"
                role="tablist"
                aria-label={`${activeGroup.label} sections`}
              >
                {#each activeSections as section (section.id)}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeSectionId === section.id}
                    class:active={activeSectionId === section.id}
                    onclick={() => selectSection(section.id)}
                  >
                    {section.label}
                  </button>
                {/each}
              </div>
            {/if}
          </header>
        {/if}

        {@render children(activeGroup)}
      {/if}
    </div>
  </ScrollArea>
</section>
