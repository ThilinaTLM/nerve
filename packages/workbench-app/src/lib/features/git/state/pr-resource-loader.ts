import type { QueryClient } from "@tanstack/query-core";
import type { GithubPrInitial } from "@nervekit/contracts/git";

export type PrResourceState<T> = {
  data?: T;
  loading: boolean;
  refreshing: boolean;
  error?: string;
};

const PR_DETAIL_CACHE_MS = 5 * 60_000;
export type PrLoadOptions = {
  force?: boolean;
  silent?: boolean;
  criticalErrorTitle?: string;
};

type InitialSection<K extends keyof GithubPrInitial> = {
  key: readonly unknown[];
  resource: PrResourceState<GithubPrInitial[K]>;
  apply?: (data: GithubPrInitial[K]) => void;
};
type PrInitialLoad = {
  key: readonly unknown[];
  query: () => Promise<GithubPrInitial>;
  staleTime: number;
  options?: PrLoadOptions;
  core: InitialSection<"core">;
  conversation: InitialSection<"conversation">;
  overview: InitialSection<"overview">;
};
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Coordinates projection of cached/query results into PR resources.
 * QueryClient owns network deduplication and freshness. These claims additionally
 * protect initial-bundle fan-out from newer section projections.
 */
export class PrResourceLoader {
  private readonly projectionRequests = new Map<string, Promise<unknown>>();
  private readonly projectionVersions = new Map<string, number>();

  constructor(
    private readonly dependencies: {
      queryClient: QueryClient;
      now: () => number;
      reportError: (title: string, details: string) => void;
    },
  ) {}
  private claimResource(key: readonly unknown[]): number {
    const requestKey = JSON.stringify(key);
    const version = (this.projectionVersions.get(requestKey) ?? 0) + 1;
    this.projectionVersions.set(requestKey, version);
    return version;
  }

  private ownsResource(key: readonly unknown[], version: number): boolean {
    return this.projectionVersions.get(JSON.stringify(key)) === version;
  }

  async load<T>(input: {
    key: readonly unknown[];
    query: () => Promise<T>;
    staleTime: number;
    resource: PrResourceState<T>;
    options?: PrLoadOptions;
    apply?: (data: T) => void;
  }): Promise<T | undefined> {
    const requestKey = JSON.stringify(input.key);
    const existing = this.projectionRequests.get(requestKey) as
      | Promise<T | undefined>
      | undefined;
    if (existing) return existing;

    const version = this.claimResource(input.key);
    if (!input.options?.force) {
      const queryState = this.dependencies.queryClient.getQueryState<T>(
        input.key,
      );
      const cached = this.dependencies.queryClient.getQueryData<T>(input.key);
      if (cached !== undefined && this.ownsResource(input.key, version)) {
        if (input.resource.data !== cached) {
          input.resource.data = cached;
          input.apply?.(cached);
        }
        input.resource.error = undefined;
      }
      if (
        cached !== undefined &&
        queryState?.dataUpdatedAt !== undefined &&
        this.dependencies.now() - queryState.dataUpdatedAt < input.staleTime
      )
        return cached;
    }

    const request = (async (): Promise<T | undefined> => {
      const hadData = input.resource.data !== undefined;
      input.resource.loading = !hadData;
      input.resource.refreshing = hadData;
      if (!input.options?.silent) input.resource.error = undefined;
      try {
        if (input.options?.force) {
          await this.dependencies.queryClient.invalidateQueries({
            queryKey: input.key,
          });
        }
        const data = await this.dependencies.queryClient.fetchQuery({
          queryKey: input.key,
          queryFn: input.query,
          staleTime: input.staleTime,
          gcTime: PR_DETAIL_CACHE_MS,
        });
        if (this.ownsResource(input.key, version)) {
          if (input.resource.data !== data) {
            input.resource.data = data;
            input.apply?.(data);
          }
          input.resource.error = undefined;
        }
        return data;
      } catch (error) {
        const details = message(error);
        if (
          this.ownsResource(input.key, version) &&
          (!input.options?.silent || !hadData)
        )
          input.resource.error = details;
        if (input.options?.criticalErrorTitle)
          this.dependencies.reportError(
            input.options.criticalErrorTitle,
            details,
          );
        return undefined;
      } finally {
        if (this.ownsResource(input.key, version)) {
          input.resource.loading = false;
          input.resource.refreshing = false;
        }
      }
    })();
    this.projectionRequests.set(requestKey, request);
    try {
      return await request;
    } finally {
      if (this.projectionRequests.get(requestKey) === request)
        this.projectionRequests.delete(requestKey);
    }
  }

  private hydrateInitialSection<T>(input: {
    key: readonly unknown[];
    version: number;
    initialUpdatedAt: number;
    resource: PrResourceState<T>;
    data: T;
    apply?: (data: T) => void;
  }): void {
    if (!this.ownsResource(input.key, input.version)) return;
    const sectionUpdatedAt =
      this.dependencies.queryClient.getQueryState<T>(input.key)
        ?.dataUpdatedAt ?? 0;
    if (sectionUpdatedAt > input.initialUpdatedAt) return;
    const cached =
      this.dependencies.queryClient.setQueryData<T>(input.key, input.data) ??
      input.data;
    if (input.resource.data !== cached) {
      input.resource.data = cached;
      input.apply?.(cached);
    }
    input.resource.error = undefined;
  }

  async loadInitial(
    input: PrInitialLoad,
  ): Promise<GithubPrInitial | undefined> {
    const { key: initialKey, options = {} } = input;
    const requestKey = JSON.stringify(initialKey);
    const existing = this.projectionRequests.get(requestKey) as
      | Promise<GithubPrInitial | undefined>
      | undefined;
    if (existing) return existing;

    const coreKey = input.core.key;
    const conversationKey = input.conversation.key;
    const overviewKey = input.overview.key;
    const versions = {
      core: this.claimResource(coreKey),
      conversation: this.claimResource(conversationKey),
      overview: this.claimResource(overviewKey),
    };
    const applyInitial = (data: GithubPrInitial): void => {
      const initialUpdatedAt =
        this.dependencies.queryClient.getQueryState<GithubPrInitial>(initialKey)
          ?.dataUpdatedAt ?? this.dependencies.now();
      this.hydrateInitialSection({
        key: coreKey,
        version: versions.core,
        initialUpdatedAt,
        resource: input.core.resource,
        data: data.core,
        apply: input.core.apply,
      });
      this.hydrateInitialSection({
        key: conversationKey,
        version: versions.conversation,
        initialUpdatedAt,
        resource: input.conversation.resource,
        data: data.conversation,
      });
      this.hydrateInitialSection({
        key: overviewKey,
        version: versions.overview,
        initialUpdatedAt,
        resource: input.overview.resource,
        data: data.overview,
        apply: input.overview.apply,
      });
    };

    if (!options.force) {
      const queryState =
        this.dependencies.queryClient.getQueryState<GithubPrInitial>(
          initialKey,
        );
      const cached =
        this.dependencies.queryClient.getQueryData<GithubPrInitial>(initialKey);
      if (cached !== undefined) applyInitial(cached);
      if (
        cached !== undefined &&
        queryState?.dataUpdatedAt !== undefined &&
        this.dependencies.now() - queryState.dataUpdatedAt < input.staleTime
      )
        return cached;
    }

    const resources = [
      input.core.resource,
      input.conversation.resource,
      input.overview.resource,
    ] as const;
    for (const resource of resources) {
      const hadData = resource.data !== undefined;
      resource.loading = !hadData;
      resource.refreshing = hadData;
      if (!options.silent) resource.error = undefined;
    }

    const request = (async (): Promise<GithubPrInitial | undefined> => {
      try {
        if (options.force)
          await this.dependencies.queryClient.invalidateQueries({
            queryKey: initialKey,
          });
        const data = await this.dependencies.queryClient.fetchQuery({
          queryKey: initialKey,
          queryFn: input.query,
          staleTime: input.staleTime,
          gcTime: PR_DETAIL_CACHE_MS,
        });
        applyInitial(data);
        return data;
      } catch (error) {
        const errorMessage = message(error);
        if (options.criticalErrorTitle)
          this.dependencies.reportError(
            options.criticalErrorTitle,
            errorMessage,
          );
        for (const [resource, key, version] of [
          [input.core.resource, coreKey, versions.core],
          [input.conversation.resource, conversationKey, versions.conversation],
          [input.overview.resource, overviewKey, versions.overview],
        ] as const) {
          if (
            this.ownsResource(key, version) &&
            (!options.silent || resource.data === undefined)
          )
            resource.error = errorMessage;
        }
        return undefined;
      } finally {
        for (const [resource, key, version] of [
          [input.core.resource, coreKey, versions.core],
          [input.conversation.resource, conversationKey, versions.conversation],
          [input.overview.resource, overviewKey, versions.overview],
        ] as const) {
          if (this.ownsResource(key, version)) {
            resource.loading = false;
            resource.refreshing = false;
          }
        }
      }
    })();
    this.projectionRequests.set(requestKey, request);
    try {
      return await request;
    } finally {
      if (this.projectionRequests.get(requestKey) === request)
        this.projectionRequests.delete(requestKey);
    }
  }
}
