<script lang="ts">
  import Settings from "@lucide/svelte/icons/settings";
  import type {
    GitBranchSummary,
    GitFileChange,
    GitOverviewResponse,
    GitRepoSummary,
    GithubPr,
    GithubStatusResponse,
    ManagedSandboxRecord,
    StartupSetupStatus,
  } from "@nervekit/contracts";
  import { Badge } from "@nervekit/workbench-ui/components/ui/badge";
  import { Button } from "@nervekit/workbench-ui/components/ui/button";
  import { PanelSection } from "@nervekit/workbench-ui/components/workbench";
  import GitChangesSection from "@nervekit/workbench-ui/git/GitChangesSection.svelte";
  import GitPrSection from "@nervekit/workbench-ui/git/GitPrSection.svelte";
  import GitRepoBranchSection from "@nervekit/workbench-ui/git/GitRepoBranchSection.svelte";
  import { notify } from "@nervekit/workbench-ui/core/notify";
  import {
    createSandboxGitBranch,
    discoverSandboxGitRepos,
    getSandboxGithubStatus,
    getSandboxGitOverview,
    listSandboxGitBranches,
    listSandboxGithubPrs,
    sandboxGitFileAction,
    sandboxGitRemoteAction,
    switchSandboxGitBranch,
  } from "../../api/sandbox-git.api";
  import { sandboxCanForwardCommand } from "../../state/sandbox-lifecycle";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import type {
    SandboxDetailState,
    SandboxDiagnosticTabId,
  } from "../../state/sandbox-ui-types";

  type PlainRecord = Record<string, unknown>;
  type FileMutation = {
    path: string;
    action: "stage" | "unstage" | "discard";
  };

  let {
    record,
    detail,
    onOpenDiagnosticTab,
  }: {
    record: ManagedSandboxRecord;
    detail?: SandboxDetailState;
    onOpenDiagnosticTab?: (id: SandboxDiagnosticTabId) => void;
  } = $props();

  const store = useSandboxManagerStore();
  const connected = $derived(sandboxCanForwardCommand(record, detail));
  const status = $derived(detail?.status ?? detail?.snapshot);
  const config = $derived(asRecord(status?.config));
  const gitConfig = $derived(asRecord(config.git));
  const githubConfig = $derived(asRecord(config.github));
  const gitIdentity = $derived(asRecord(gitConfig.identity));

  let repos = $state<GitRepoSummary[]>([]);
  let selectedRepo = $state(".");
  let overview = $state<GitOverviewResponse | undefined>(undefined);
  let branches = $state<GitBranchSummary[]>([]);
  let github = $state<GithubStatusResponse | undefined>(undefined);
  let prs = $state<GithubPr[]>([]);
  let error = $state<string | undefined>(undefined);

  let loadingRepos = $state(false);
  let loadingOverview = $state(false);
  let loadingBranches = $state(false);
  let loadingPrs = $state(false);
  let refreshing = $state(false);
  let switchingBranch = $state<string | undefined>(undefined);
  let creatingBranch = $state(false);
  let fetching = $state(false);
  let pulling = $state(false);
  let pushing = $state(false);
  let syncing = $state(false);
  let switchingBaseAndPulling = $state(false);
  let fileMutation = $state<FileMutation | undefined>(undefined);
  let bulkMutation = $state<string | undefined>(undefined);

  let branchFilter = $state("");
  let newBranchName = $state("");
  let branchPopoverOpen = $state(false);
  let repoOpen = $state(true);
  let changesOpen = $state(true);
  let prsOpen = $state(true);
  let setupOpen = $state(false);
  let loadedSandboxId = $state<string | undefined>(undefined);
  let autoRefreshAttemptedSandboxId = $state<string | undefined>(undefined);

  const selectedRepoSummary = $derived(
    overview?.repo ?? repos.find((repo) => repo.relativePath === selectedRepo),
  );
  const stagedFiles = $derived(
    overview?.files.filter((file) => file.staged) ?? [],
  );
  const unstagedFiles = $derived(
    overview?.files.filter((file) => file.untracked || file.worktree !== " ") ?? [],
  );
  const filteredBranches = $derived(
    branches.filter((branch) =>
      branch.name.toLowerCase().includes(branchFilter.trim().toLowerCase()),
    ),
  );
  const sortedPrs = $derived(
    [...prs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );

  $effect(() => {
    if (record.sandboxId === loadedSandboxId) return;
    loadedSandboxId = record.sandboxId;
    autoRefreshAttemptedSandboxId = undefined;
    repos = [];
    overview = undefined;
    branches = [];
    github = undefined;
    prs = [];
  });

  $effect(() => {
    if (!connected) {
      autoRefreshAttemptedSandboxId = undefined;
      return;
    }
    if (
      repos.length === 0 &&
      !loadingRepos &&
      autoRefreshAttemptedSandboxId !== record.sandboxId
    ) {
      autoRefreshAttemptedSandboxId = record.sandboxId;
      void refreshAll();
    }
  });

  function asRecord(value: unknown): PlainRecord {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as PlainRecord)
      : {};
  }

  function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  }

  function booleanLabel(value: unknown): string {
    if (typeof value !== "boolean") return "—";
    return value ? "yes" : "no";
  }

  function setupTone(status_: StartupSetupStatus | undefined): "good" | "warn" | "danger" | "running" | "neutral" {
    if (!status_) return "neutral";
    if (status_.status === "completed") return "good";
    if (status_.status === "failed") return "danger";
    if (status_.status === "started") return "running";
    if (status_.status === "degraded") return "warn";
    return "neutral";
  }

  function formatSetup(status_: StartupSetupStatus | undefined): string {
    if (!status_) return "not reported";
    return status_.configured ? status_.status : `not configured · ${status_.status}`;
  }

  function errorMessage(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
  }

  async function refreshAll(): Promise<void> {
    if (!connected) return;
    refreshing = true;
    loadingRepos = true;
    try {
      const discovery = await discoverSandboxGitRepos(record.sandboxId);
      repos = discovery.repos;
      selectedRepo = repos.some((repo) => repo.relativePath === selectedRepo)
        ? selectedRepo
        : (repos[0]?.relativePath ?? ".");
      await refreshRepo(selectedRepo);
      error = undefined;
    } catch (caught) {
      error = errorMessage(caught);
    } finally {
      loadingRepos = false;
      refreshing = false;
    }
  }

  async function refreshRepo(repo: string): Promise<void> {
    if (!connected) return;
    selectedRepo = repo;
    await Promise.all([
      refreshOverview(repo),
      refreshBranches(repo),
      refreshGithub(repo),
    ]);
  }

  async function refreshOverview(repo = selectedRepo): Promise<void> {
    loadingOverview = true;
    try {
      overview = await getSandboxGitOverview(record.sandboxId, repo);
      repos = repos.map((candidate) =>
        candidate.relativePath === overview?.repo.relativePath
          ? overview.repo
          : candidate,
      );
    } catch (caught) {
      error = errorMessage(caught);
    } finally {
      loadingOverview = false;
    }
  }

  async function refreshBranches(repo = selectedRepo): Promise<void> {
    loadingBranches = true;
    try {
      branches = (await listSandboxGitBranches(record.sandboxId, repo)).branches;
    } catch (caught) {
      error = errorMessage(caught);
    } finally {
      loadingBranches = false;
    }
  }

  async function refreshGithub(repo = selectedRepo): Promise<void> {
    try {
      github = await getSandboxGithubStatus(record.sandboxId, repo);
      if (github.authenticated) await refreshPrs(repo);
      else prs = [];
    } catch {
      github = undefined;
      prs = [];
    }
  }

  async function refreshPrs(repo = selectedRepo): Promise<void> {
    loadingPrs = true;
    try {
      prs = (await listSandboxGithubPrs(record.sandboxId, repo)).prs;
    } catch (caught) {
      notify.error("Could not load pull requests", { description: errorMessage(caught) });
    } finally {
      loadingPrs = false;
    }
  }

  async function switchBranch(repo: string, branch: GitBranchSummary): Promise<void> {
    switchingBranch = branch.name;
    try {
      await switchSandboxGitBranch(record.sandboxId, { repo, name: branch.name });
      branchPopoverOpen = false;
      await refreshRepo(repo);
    } catch (caught) {
      notify.error("Could not switch branch", { description: errorMessage(caught) });
    } finally {
      switchingBranch = undefined;
    }
  }

  async function createBranch(repo: string): Promise<void> {
    const name = newBranchName.trim();
    if (!name) return;
    creatingBranch = true;
    try {
      await createSandboxGitBranch(record.sandboxId, { repo, name });
      newBranchName = "";
      branchPopoverOpen = false;
      await refreshRepo(repo);
    } catch (caught) {
      notify.error("Could not create branch", { description: errorMessage(caught) });
    } finally {
      creatingBranch = false;
    }
  }

  async function remoteAction(
    repo: string,
    action: "sync" | "push" | "pull" | "fetch" | "switchBaseAndPull",
  ): Promise<void> {
    const flag = setRemoteFlag(action, true);
    try {
      await sandboxGitRemoteAction(record.sandboxId, action, { repo });
      await refreshRepo(repo);
    } catch (caught) {
      notify.error("Git operation failed", { description: errorMessage(caught) });
    } finally {
      flag(false);
    }
  }

  function setRemoteFlag(action: string, value: boolean): (next: boolean) => void {
    if (action === "fetch") fetching = value;
    if (action === "pull") pulling = value;
    if (action === "push") pushing = value;
    if (action === "sync") syncing = value;
    if (action === "switchBaseAndPull") switchingBaseAndPulling = value;
    return (next) => setRemoteFlag(action, next);
  }

  async function mutateFile(
    repo: string,
    file: GitFileChange,
    action: "stage" | "unstage" | "discard",
  ): Promise<void> {
    fileMutation = { path: file.path, action };
    try {
      await sandboxGitFileAction(record.sandboxId, action, { repo, path: file.path });
      await refreshOverview(repo);
    } catch (caught) {
      notify.error("Could not update file", { description: errorMessage(caught) });
    } finally {
      fileMutation = undefined;
    }
  }

  async function bulkStage(repo: string, action: "stage-all" | "unstage-all"): Promise<void> {
    const files = action === "stage-all" ? unstagedFiles : stagedFiles;
    bulkMutation = action;
    try {
      for (const file of files) {
        await sandboxGitFileAction(record.sandboxId, action === "stage-all" ? "stage" : "unstage", {
          repo,
          path: file.path,
        });
      }
      await refreshOverview(repo);
    } catch (caught) {
      notify.error("Could not update files", { description: errorMessage(caught) });
    } finally {
      bulkMutation = undefined;
    }
  }

  function requestDiscard(file: GitFileChange): void {
    if (window.confirm(`Discard changes to ${file.path}? This cannot be undone.`)) {
      void mutateFile(selectedRepo, file, "discard");
    }
  }

  function openPr(number: number): void {
    store.openWorkspacePr(record.sandboxId, selectedRepo, number);
  }
</script>

<div class="flex flex-col gap-2 p-2">
  {#if !connected}
    <p class="rounded-md border border-dashed px-2 py-2 text-xs text-muted-foreground">
      Connect or start the sandbox to inspect Git state and run Git operations.
    </p>
  {:else if error}
    <p class="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-2 text-xs text-destructive">
      {error}
    </p>
  {/if}

  {#if connected && (repos.length > 0 || loadingRepos || overview)}
    <GitRepoBranchSection
      repoSummary={selectedRepoSummary}
      {repos}
      {selectedRepo}
      {filteredBranches}
      {loadingBranches}
      {switchingBranch}
      {creatingBranch}
      {fetching}
      {pulling}
      {pushing}
      {syncing}
      {switchingBaseAndPulling}
      {refreshing}
      bind:branchFilter
      bind:newBranchName
      bind:branchPopoverOpen
      bind:open={repoOpen}
      onSelectRepo={(repo) => void refreshRepo(repo)}
      onSwitchBranch={(repo, branch) => void switchBranch(repo, branch)}
      onCreateBranch={(repo) => void createBranch(repo)}
      onFetch={(repo) => void remoteAction(repo, "fetch")}
      onPull={(repo) => void remoteAction(repo, "pull")}
      onPush={(repo) => void remoteAction(repo, "push")}
      onSync={(repo) => void remoteAction(repo, "sync")}
      onSwitchBaseAndPull={(repo) => void remoteAction(repo, "switchBaseAndPull")}
    />

    <GitChangesSection
      changes={overview}
      {stagedFiles}
      {unstagedFiles}
      {fileMutation}
      {bulkMutation}
      {selectedRepo}
      {loadingOverview}
      bind:open={changesOpen}
      onMutateFile={(repo, file, action) => void mutateFile(repo, file, action)}
      onBulkStage={(repo, action) => void bulkStage(repo, action)}
      onRequestDiscard={requestDiscard}
    />

    <GitPrSection
      {sortedPrs}
      {prs}
      selectedRepoSummary={selectedRepoSummary}
      {github}
      selectedRepoHasGithubRemote={Boolean(selectedRepoSummary?.hasGithubRemote)}
      {loadingPrs}
      currentBranchName={selectedRepoSummary?.currentBranch ?? null}
      bind:open={prsOpen}
      onRefreshPrs={() => void refreshPrs()}
      onOpenPr={openPr}
    />
  {:else if connected}
    <PanelSection title="Repo & Branch" bind:open={repoOpen}>
      <div class="flex flex-col gap-2">
        <p class="text-xs text-muted-foreground">No Git repositories found under /workspace.</p>
        <Button size="xs" variant="outline" onclick={() => void refreshAll()}>Refresh</Button>
      </div>
    </PanelSection>
  {/if}

  <PanelSection title="Git setup" icon={Settings} bind:open={setupOpen}>
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap gap-1.5">
        <Badge tone={setupTone(status?.setup?.git)} size="xs">git: {formatSetup(status?.setup?.git)}</Badge>
        <Badge tone={setupTone(status?.setup?.github)} size="xs">github: {formatSetup(status?.setup?.github)}</Badge>
      </div>
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt class="text-xs text-muted-foreground">Author</dt>
        <dd class="truncate text-xs">{stringValue(gitIdentity.name) ?? "—"}{#if stringValue(gitIdentity.email)} <span class="text-muted-foreground">{stringValue(gitIdentity.email)}</span>{/if}</dd>
        <dt class="text-xs text-muted-foreground">GitHub</dt>
        <dd class="truncate text-xs">{stringValue(githubConfig.host) ?? "github.com"} · enabled {booleanLabel(githubConfig.enabled)}</dd>
        <dt class="text-xs text-muted-foreground">LFS</dt>
        <dd class="truncate text-xs">{booleanLabel(gitConfig.lfs)}</dd>
        <dt class="text-xs text-muted-foreground">Config</dt>
        <dd class="truncate font-mono text-xs">{status?.configDigest ?? record.configDigest ?? "—"}</dd>
      </dl>
      {#if status?.setup?.git?.error || status?.setup?.github?.error}
        <p class="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {status.setup.git?.error?.message ?? status.setup.github?.error?.message}
        </p>
      {/if}
      <Button size="xs" variant="outline" onclick={() => onOpenDiagnosticTab?.("config")}>Open config YAML</Button>
    </div>
  </PanelSection>
</div>
