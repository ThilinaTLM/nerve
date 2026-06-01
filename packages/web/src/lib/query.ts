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
};
