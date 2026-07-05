<script lang="ts">
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
  } from "@nervekit/ui/components/ui/card";
  import type {
    SettingsSection,
    SettingsSectionId,
  } from "../../settings/provider-catalog";

  let {
    sections,
    activeSectionId,
    countForSection,
    onselect,
  }: {
    sections: SettingsSection[];
    activeSectionId: SettingsSectionId;
    countForSection: (section: SettingsSection) => number;
    onselect: (sectionId: SettingsSectionId) => void;
  } = $props();
</script>

<Card class="border">
  <CardHeader class="border-b p-4">
    <CardTitle class="text-sm">Configuration sections</CardTitle>
    <p class="text-xs text-muted-foreground">
      Choose a section to review configured options.
    </p>
  </CardHeader>
  <CardContent class="grid gap-1 p-2">
    {#each sections as section (section.id)}
      {@const Icon = section.icon}
      {@const sectionCount = countForSection(section)}
      <Button
        variant={activeSectionId === section.id ? "secondary" : "ghost"}
        active={activeSectionId === section.id}
        aria-current={activeSectionId === section.id ? "page" : undefined}
        onclick={() => onselect(section.id)}
        class="h-auto w-full justify-start gap-3 px-3 py-3 text-left"
      >
        <span class="rounded-md bg-muted p-2 text-muted-foreground">
          <Icon class="size-4" />
        </span>
        <span class="min-w-0 flex-1 space-y-1">
          <span class="flex items-center justify-between gap-2">
            <span class="truncate text-sm font-medium">{section.label}</span>
            <Badge tone={sectionCount > 0 ? "accent" : "neutral"} size="xs">
              {sectionCount}
            </Badge>
          </span>
          <span class="line-clamp-2 whitespace-normal text-xs font-normal text-muted-foreground">
            {section.description}
          </span>
        </span>
      </Button>
    {/each}
  </CardContent>
</Card>
