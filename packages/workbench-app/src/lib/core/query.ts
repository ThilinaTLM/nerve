import { QueryClient } from "@tanstack/svelte-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const queryKeys = {
  clientConfig: ["client-config"] as const,
  workspace: ["workspace"] as const,
  slashCompletions: ["completions", "slash"] as const,
  fileCompletions: (projectId: string | undefined, query: string) =>
    ["completions", "files", projectId ?? "none", query] as const,
  git: {
    project: (projectId: string) => ["git", projectId] as const,
    repos: (projectId: string) => ["git", projectId, "repos"] as const,
    repo: (projectId: string, repo: string) =>
      ["git", projectId, "repo", repo] as const,
    overview: (projectId: string, repo: string) =>
      ["git", projectId, "repo", repo, "overview"] as const,
    branches: (projectId: string, repo: string) =>
      ["git", projectId, "repo", repo, "branches"] as const,
    githubStatus: (projectId: string, repo: string) =>
      ["git", projectId, "repo", repo, "github-status"] as const,
    prs: (projectId: string, repo: string, filters: string) =>
      ["git", projectId, "repo", repo, "prs", filters] as const,
    pr: (projectId: string, repo: string, number: number) =>
      ["git", projectId, "repo", repo, "pr", number] as const,
    prInitial: (projectId: string, repo: string, number: number) =>
      ["git", projectId, "repo", repo, "pr", number, "initial"] as const,
    prSection: (
      projectId: string,
      repo: string,
      number: number,
      section: "core" | "conversation" | "overview" | "checks",
    ) => ["git", projectId, "repo", repo, "pr", number, section] as const,
    prHeadSection: (
      projectId: string,
      repo: string,
      number: number,
      section: "commits" | "files",
      headOid: string,
    ) =>
      ["git", projectId, "repo", repo, "pr", number, section, headOid] as const,
  },
};
