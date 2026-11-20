<!--
  "In this project": the end of a user page whose project counterpart has
  content. One row names what the project has, with pending items as its
  problem line, and opens the matching project page.
-->
<script lang="ts">
import FolderGit2 from "@lucide/svelte/icons/folder-git-2";
import type { ProjectGuide } from "$lib/application/configuration-attention/project-guides";
import {
  SettingsItem,
  SettingsList,
  SettingsSection,
} from "$lib/presentation/settings";

let { guide, onOpen }: { guide: ProjectGuide; onOpen: () => void } = $props();
</script>

<SettingsSection
  title="In this project"
  description={guide.description}
  surface={false}
>
  <SettingsList ariaLabel="In this project">
    <SettingsItem
      title={guide.title}
      icon={FolderGit2}
      summary={guide.problem ? undefined : guide.summary}
      problem={guide.problem}
      problemAction={guide.problem
        ? { label: "Review", onclick: onOpen }
        : undefined}
      {onOpen}
      openLabel={guide.openLabel}
    />
  </SettingsList>
</SettingsSection>
