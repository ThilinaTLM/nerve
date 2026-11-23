<!--
  Project settings › Skills › name: where the user approves a project skill.
  Shows what the agent is told (name and description, all that enters its
  instructions) and every file the approval covers, scripts marked, each one
  click away. The full SKILL.md is not inlined.
-->
<script lang="ts">
import {
  FieldRow,
  PageEmptyState,
  PageHeader,
  PageItem,
  PageList,
} from "@nervekit/ui-kit/components/composites/page";
import { untrack } from "svelte";
import FileCode from "@lucide/svelte/icons/file-code";
import FileText from "@lucide/svelte/icons/file-text";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import {
  formatBytes,
  scriptCount,
  skillFilePath,
  skillReviewCaption,
} from "$lib/application/skills/skill-review";
import { SkillReviewState } from "$lib/application/skills/skill-review-state.svelte";
import { SettingsSection } from "$lib/presentation/settings";

let {
  projectId,
  name,
  onBack,
  onOpenFile,
}: {
  projectId: string;
  name: string;
  /** Returns to the Skills list. */
  onBack: () => void;
  /** Opens one file of the skill by absolute path. */
  onOpenFile?: (path: string) => void;
} = $props();

const session = $derived(new SkillReviewState(projectId, name));
$effect(() => {
  const current = session;
  untrack(() => void current.load());
});

const review = $derived(session.review);
const approved = $derived(review?.status === "approved");
const scripts = $derived(review ? scriptCount(review) : 0);
</script>

<PageHeader
  title={name}
  description={review
    ? skillReviewCaption(review.status)
    : session.phase === "missing"
      ? "This skill is no longer in the project"
      : undefined}
  parent={{ label: "Skills", onBack }}
>
  {#snippet actions()}
    {#if review && approved}
      <Button
        size="sm"
        variant="ghost"
        disabled={session.busy}
        onclick={() => void session.withdraw()}>Withdraw approval</Button
      >
    {:else if review}
      <Button
        size="sm"
        disabled={session.busy}
        onclick={() => void session.approve()}
        >{review.status === "changed" ? "Approve changes" : "Approve"}</Button
      >
    {/if}
  {/snippet}
</PageHeader>

{#if session.notice}
  <Callout tone="warning" icon={TriangleAlert} text={session.notice} />
{/if}

{#if session.phase === "loading"}
  <Skeleton class="h-24 w-full" />
{:else if session.phase === "missing"}
  <PageEmptyState
    variant="card"
    title="Skill not found"
    description={`The project has no skill named "${name}" any more. It may have been renamed, moved or deleted.`}
  >
    {#snippet actions()}
      <Button size="sm" variant="outline" onclick={onBack}
        >Back to Skills</Button
      >
    {/snippet}
  </PageEmptyState>
{:else if session.phase === "error"}
  <Callout
    layout="block"
    tone="destructive"
    text={session.error ?? "Could not load the skill."}
  >
    {#snippet actions()}
      <Button size="sm" variant="outline" onclick={() => void session.load()}
        >Retry</Button
      >
    {/snippet}
  </Callout>
{:else if review}
  {#if session.error}
    <Callout tone="destructive" text={session.error} />
  {/if}

  <SettingsSection
    title="What the agent is told"
    description="Added to the agent's instructions in this project. It reads the files below only when a task matches."
    divided
  >
    <FieldRow label={review.name} description="Name" />
    <FieldRow
      label={review.description || "No description"}
      description="When the agent should use it"
    />
  </SettingsSection>

  <SettingsSection
    title="Files"
    description="Approval covers exactly these files. Any change asks you again."
    surface={false}
  >
    <PageList ariaLabel="Skill files">
      {#each review.files as file (file.path)}
        <PageItem
          title={file.path}
          icon={file.script ? FileCode : FileText}
          compact
          onOpen={onOpenFile
            ? () => onOpenFile(skillFilePath(review.folder, file.path))
            : undefined}
          openLabel={`Open ${file.path}`}
        >
          {#snippet badges()}
            {#if file.script}<Badge variant={approved ? "neutral" : "warning"}
                >Script</Badge
              >{/if}
          {/snippet}
          {#snippet meta()}
            <span class="text-caption text-muted-foreground"
              >{formatBytes(file.bytes)}</span
            >
          {/snippet}
        </PageItem>
      {/each}
    </PageList>
  </SettingsSection>

  {#if scripts > 0 && !approved}
    <Callout
      tone="warning"
      icon={TriangleAlert}
      text={`This skill includes ${scripts} script${scripts === 1 ? "" : "s"}. The agent may run ${scripts === 1 ? "it" : "them"} when it uses the skill; your permission rules still apply to that command.`}
    />
  {/if}
{/if}
