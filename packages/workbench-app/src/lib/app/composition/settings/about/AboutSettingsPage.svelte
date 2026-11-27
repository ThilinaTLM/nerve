<!--
  Settings › About: the version with its update status and commands, the
  license and links to the website, docs and repository.
-->
<script lang="ts">
import BookOpen from "@lucide/svelte/icons/book-open";
import CircleDot from "@lucide/svelte/icons/circle-dot";
import CodeXml from "@lucide/svelte/icons/code-xml";
import Globe from "@lucide/svelte/icons/globe";
import Tag from "@lucide/svelte/icons/tag";
import type { LatestRelease } from "@nervekit/contracts/status";
import {
  FieldRow,
  PageItem,
  PageList,
} from "@nervekit/ui-kit/components/composites/page";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { SettingsSection } from "$lib/presentation/settings";
import {
  displayVersion,
  isVersionOutdated,
  ReleaseCommands,
} from "$lib/features/releases";

let {
  version,
  latestRelease,
}: {
  /** The running daemon's version; absent until the status loads. */
  version?: string;
  latestRelease?: LatestRelease;
} = $props();

const REPOSITORY = "https://github.com/ThilinaTLM/nerve";

const links = [
  {
    id: "website",
    title: "Website",
    summary: "nerve.tlmtech.dev",
    href: "https://nerve.tlmtech.dev",
    icon: Globe,
  },
  {
    id: "docs",
    title: "Documentation",
    summary: "Guides and reference",
    href: "https://nerve.tlmtech.dev/start/",
    icon: BookOpen,
  },
  {
    id: "repository",
    title: "Source code",
    summary: "github.com/ThilinaTLM/nerve",
    href: REPOSITORY,
    icon: CodeXml,
  },
  {
    id: "releases",
    title: "Releases",
    summary: "What changed in each version",
    href: `${REPOSITORY}/releases`,
    icon: Tag,
  },
  {
    id: "issues",
    title: "Issues",
    summary: "Report a problem or ask for a feature",
    href: `${REPOSITORY}/issues`,
    icon: CircleDot,
  },
];

const outdated = $derived(isVersionOutdated(version, latestRelease?.version));
const status = $derived(
  !latestRelease
    ? "Couldn't check for a newer release. Nerve tries again on its own."
    : outdated
      ? `${displayVersion(latestRelease.version)} is available.`
      : "Up to date.",
);

function open(href: string): void {
  window.open(href, "_blank", "noopener,noreferrer");
}
</script>

<SettingsSection id="version" title="Version" divided>
  <FieldRow
    label={version ? `Nerve ${displayVersion(version)}` : "Nerve"}
    description={version ? status : "Reading the version."}
  >
    {#snippet control()}
      {#if latestRelease}
        <Button
          variant="outline"
          size="sm"
          href={latestRelease.releaseUrl}
          target="_blank"
          rel="noreferrer">Release notes</Button
        >
      {/if}
    {/snippet}
  </FieldRow>
  {#if outdated && latestRelease}
    <FieldRow
      label="Run the latest release"
      description="Quit Nerve, then start it with one of these."
      layout="stacked"
    >
      <ReleaseCommands version={latestRelease.version} />
    </FieldRow>
  {/if}
</SettingsSection>

<SettingsSection id="license" title="License" divided>
  <FieldRow label="Apache License 2.0" description="Nerve is open source.">
    {#snippet control()}
      <Button
        variant="outline"
        size="sm"
        href={`${REPOSITORY}/blob/main/LICENSE`}
        target="_blank"
        rel="noreferrer">View license</Button
      >
    {/snippet}
  </FieldRow>
</SettingsSection>

<SettingsSection id="links" title="Links">
  <PageList ariaLabel="Links">
    {#each links as link (link.id)}
      <PageItem
        title={link.title}
        icon={link.icon}
        summary={link.summary}
        openLabel={`Open ${link.title.toLowerCase()} in the browser`}
        onOpen={() => open(link.href)}
      />
    {/each}
  </PageList>
</SettingsSection>
