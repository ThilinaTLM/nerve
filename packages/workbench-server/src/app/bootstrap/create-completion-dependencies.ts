import type { ConversationCore } from "@nervekit/conversation-core";
import type { CompletionScope } from "@nervekit/contracts/completions";
import type { GitService } from "@nervekit/tools/git";
import type { WorkbenchNoticePublisher } from "../../infrastructure/events/index.js";
import {
  createCompletionProviders,
  mergeCompletionRemoteSnapshots,
  type CompletionSourcePorts,
} from "../../domains/completions/completion-source-providers.js";
import {
  createCompletionContextReader,
  type CompletionContextReaderPorts,
} from "../../domains/completions/completion-context-reader.js";
import type {
  CompletionServiceDependencies,
  CompletionProvider,
} from "../../domains/completions/completion-provider.js";

export interface CompletionRuntimeBindings {
  home: string;
  sources: Omit<CompletionSourcePorts, "prs" | "issues" | "remoteChanged">;
  git: Pick<
    GitService,
    "discoverRepos" | "cachedOpenPrs" | "listIssues" | "onRemoteCacheChanged"
  >;
  context: CompletionContextReaderPorts;
  events: Pick<
    WorkbenchNoticePublisher,
    "subscribeNotify" | "publishBestEffort"
  >;
  core: Pick<ConversationCore, "subscribe">;
}

/** Explicit host bindings; no full conversation snapshots or transport services bag. */
export function createCompletionDependencies(
  bindings: CompletionRuntimeBindings,
): CompletionServiceDependencies {
  const { sources, git, events, core } = bindings;
  const repositoryPaths = async (projectId: string) => {
    const discovery = await git.discoverRepos(projectId);
    // Ignore known non-GitHub repos, but retain uncertain discovery/error paths.
    const paths = [
      ...new Set([
        ...discovery.repos
          .filter((repo) => repo.hasGithubRemote !== false)
          .map((repo) => repo.relativePath),
        ...(discovery.errors ?? []).map((error) => error.repo),
      ]),
    ];
    return {
      paths,
      stale: discovery.stale === true,
      failureCode:
        !discovery.stale && !paths.length
          ? discovery.repos.length &&
            !discovery.repos.some((repo) => repo.hasRemote)
            ? "GH_NO_REMOTE"
            : "GH_NO_GITHUB_REMOTE"
          : undefined,
    };
  };
  const providers = createCompletionProviders({
    ...sources,
    remoteChanged: (source, invalidate) =>
      git.onRemoteCacheChanged((change) => {
        if (change.source === source)
          invalidate({ projectId: change.projectId });
      }),
    prs: async (projectId) => {
      const { paths, stale, failureCode } = await repositoryPaths(projectId);
      if (failureCode)
        return {
          items: [],
          failed: true,
          refreshing: false,
          updatedAt: null,
          failureCode,
        };
      const merged = mergeCompletionRemoteSnapshots(
        paths.map((repo) => {
          try {
            const snapshot = git.cachedOpenPrs(projectId, repo);
            return {
              items: (snapshot.result?.prs ?? []).map((pr) => ({
                ...pr,
                repository: repo,
              })),
              stale: snapshot.status !== "fresh",
              failed:
                snapshot.status === "unavailable" || !!snapshot.failureCode,
              failureCode: snapshot.failureCode,
              refreshing: snapshot.refreshing,
              updatedAt: snapshot.updatedAt,
            };
          } catch {
            return {
              items: [],
              stale: true,
              failed: true,
              refreshing: false,
              updatedAt: null,
            };
          }
        }),
      );
      return { ...merged, stale: stale || merged.stale === true };
    },
    issues: async (projectId) => {
      const { paths, stale, failureCode } = await repositoryPaths(projectId);
      if (failureCode)
        return {
          items: [],
          failed: true,
          refreshing: false,
          updatedAt: null,
          failureCode,
        };
      const merged = mergeCompletionRemoteSnapshots(
        paths.map((repo) => {
          try {
            const snapshot = git.listIssues(projectId, repo);
            return {
              items: snapshot.issues.map((issue) => ({
                ...issue,
                repository: repo,
              })),
              stale: snapshot.status !== "fresh",
              failed:
                snapshot.status === "unavailable" || !!snapshot.failureCode,
              failureCode: snapshot.failureCode,
              refreshing: snapshot.refreshing,
              updatedAt: snapshot.updatedAt,
            };
          } catch {
            return {
              items: [],
              stale: true,
              failed: true,
              refreshing: false,
              updatedAt: null,
            };
          }
        }),
      );
      return { ...merged, stale: stale || merged.stale === true };
    },
  }).map((provider): CompletionProvider => {
    const notices: Record<string, string[]> = {
      files: ["filesystem.project.changed"],
      launches: ["launch."],
      launch_definitions: ["launchCatalog."],
      skills: ["settings.updated", "filesystem.project.changed"],
      tools: [
        "settings.updated",
        "providers.",
        "auth.providers_changed",
        "filesystem.project.changed",
      ],
      profiles: [
        "settings.updated",
        "providers.",
        "auth.providers_changed",
        "filesystem.project.changed",
      ],
    };
    return {
      ...provider,
      subscribe: (invalidate) => {
        const stopProvider = provider.subscribe?.(invalidate);
        const stopNotices = events.subscribeNotify((event) => {
          if (provider.id === "launches" && event.type === "launch.output")
            return;
          if (
            !notices[provider.id]?.some((prefix) =>
              event.type.startsWith(prefix),
            )
          )
            return;
          const data = event.data as {
            projectId?: string;
            launch?: { projectId?: string };
            refreshCause?: "uncertain_poll";
          };
          const projectId = data.projectId ?? data.launch?.projectId;
          invalidate(
            projectId ? { projectId } : undefined,
            event.type === "filesystem.project.changed" &&
              data.refreshCause === "uncertain_poll"
              ? { refreshCause: "uncertain_poll" }
              : undefined,
          );
        });
        const stopCore =
          provider.id === "subagents"
            ? core.subscribe((change) => {
                if (change.kind === "conversation_changed") {
                  const child = change.summary;
                  if (child.parentConversationId)
                    invalidate({
                      projectId: child.projectId,
                      conversationId: child.parentConversationId,
                    });
                } else if (change.kind === "conversation_deleted") invalidate();
              })
            : undefined;
        return () => {
          stopProvider?.();
          stopNotices();
          stopCore?.();
        };
      },
    };
  });
  return {
    home: bindings.home,
    authorize: (scope: CompletionScope) => {
      if (sources.project(scope.projectId).id !== scope.projectId)
        throw new Error("Unknown completion project");
      if (
        scope.conversationId &&
        bindings.context.metadata(scope.conversationId).projectId !==
          scope.projectId
      )
        throw new Error("Conversation belongs to another project");
    },
    context: createCompletionContextReader(bindings.context),
    providers,
    changed: (change) => events.publishBestEffort("completion.changed", change),
  };
}
