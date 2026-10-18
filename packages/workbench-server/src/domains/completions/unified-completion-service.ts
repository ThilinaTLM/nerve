import {
  parseCompletionIntent,
  completionSearchRequestSchema,
  completionSelectionRequestSchema,
  type CompletionScope,
  type CompletionSearchResponse,
  type CompletionSelectionRequest,
  type CompletionSelectionResponse,
} from "@nervekit/contracts/completions";
import {
  completionDocumentUnits as unitsOf,
  completionScopeMatches as scopeMatches,
  completionDocumentScopeMatches as validScope,
  invalidateCompletionProvider,
  settledCompletionProvider,
} from "./completion-provider-state.js";
import type { z } from "zod";
import type { SearchResult } from "@nervekit/native";
import {
  completionSeedIds,
  completionStateSeeds,
  retrieveCompletionCandidates,
  type CompletionStateSeed,
} from "./completion-seeds.js";
import { CompletionUsageStore } from "./completion-usage-store.js";
import {
  completionUsageId,
  rankCompletionCandidates,
} from "./completion-ranking-policy.js";
import { isUnsafeCompletionQuery } from "./file-completion-items.js";
import type {
  CompletionDocument,
  CompletionInvalidation,
  CompletionProvider,
  CompletionSearchIndex,
  CompletionServiceDependencies,
  ProviderState,
} from "./completion-provider.js";

type IssuedResult = {
  document: CompletionDocument;
  provider: CompletionProvider;
};
type DocumentCache = {
  scope: CompletionScope;
  documents: Map<string, CompletionDocument>;
  sources: Map<string, ProviderState>;
  issued: Map<string, IssuedResult>;
  stateSeeds: Map<string, readonly CompletionStateSeed[]>;
  version: number;
  active: number;
  retired: boolean;
};
type ProjectIndex = {
  projectId: string;
  index: Promise<CompletionSearchIndex>;
  global: DocumentCache;
  contexts: Map<string, DocumentCache>;
  activeContext?: DocumentCache;
  nativeOverlay: Map<string, CompletionDocument>;
  overlayVersion: number;
  tail: Promise<unknown>;
  revision: number;
  active: number;
  units: number;
  count: number;
  retired: boolean;
};
const hasDemand = (project: ProjectIndex, cache: DocumentCache) =>
  (cache === project.global ? project.active : cache.active) > 0;
const contextKey = (scope: CompletionScope) => scope.conversationId ?? "";

/** Exactly one native index/FIFO per project. Only small conversation overlays
 * swap; global corpora never get copied or compared on a context switch. */
export class UnifiedCompletionService {
  private readonly projects = new Map<string, ProjectIndex>();
  private readonly usage: CompletionUsageStore;
  private readonly unsubscribe: (() => void)[];
  private readonly now: () => number;
  private readonly capacity: number;
  private readonly contextCapacity: number;
  private readonly globalProviders: readonly CompletionProvider[];
  private readonly contextProviders: readonly CompletionProvider[];
  private readonly retiring = new Set<Promise<void>>();
  private activeLoads = 0;
  private closed = false;

  constructor(private readonly deps: CompletionServiceDependencies) {
    this.now = deps.now ?? Date.now;
    this.capacity = deps.maxProjects ?? 8;
    this.contextCapacity = deps.maxContextsPerProject ?? 8;
    if (
      ![this.capacity, this.contextCapacity].every(
        (value) => Number.isInteger(value) && value > 0,
      ) ||
      new Set(deps.providers.map((provider) => provider.id)).size !==
        deps.providers.length
    )
      throw new Error("Invalid completion cache/provider bounds");
    this.globalProviders = deps.providers.filter(
      (provider) => provider.scope !== "conversation",
    );
    this.contextProviders = deps.providers.filter(
      (provider) => provider.scope === "conversation",
    );
    this.usage = new CompletionUsageStore(deps.home, this.now);
    this.unsubscribe = deps.providers.flatMap((provider) =>
      provider.subscribe
        ? [
            provider.subscribe((scope, hint) =>
              this.invalidate(provider.id, scope, hint),
            ),
          ]
        : [],
    );
  }

  async search(
    input: z.input<typeof completionSearchRequestSchema>,
  ): Promise<CompletionSearchResponse> {
    const request = completionSearchRequestSchema.parse(input);
    await this.deps.authorize(request);
    const intent = parseCompletionIntent(request.q);
    if (isUnsafeCompletionQuery(intent.text))
      return { revision: 0, items: [], sources: [] };
    const { project, context } = this.acquire(request);
    try {
      await Promise.all([
        ...this.globalProviders.map((provider) =>
          this.refresh(project, project.global, provider, false),
        ),
        ...this.contextProviders.map((provider) =>
          this.refresh(project, context, provider, false),
        ),
      ]);
      const [signals, usage] = await Promise.all([
        this.deps.context(context.scope),
        this.usage.scores(project.projectId),
      ]);
      return await this.serial(project, async () => {
        // Keep the overlay and both native reads inside one project FIFO.
        await this.activate(project, context);
        const seedIds = completionSeedIds(
          signals,
          usage,
          [
            ...project.global.stateSeeds.values(),
            ...context.stateSeeds.values(),
          ],
          (id) => {
            const document =
              context.documents.get(id) ?? project.global.documents.get(id);
            return document && validScope(context.scope, document)
              ? document
              : undefined;
          },
          intent.kinds,
        );
        const result = await retrieveCompletionCandidates(
          await project.index,
          {
            text: intent.text,
            ...(intent.kinds ? { kinds: [...intent.kinds] } : {}),
          },
          seedIds,
          project.revision,
        );
        const candidates = this.items(project, context, result);
        const items = rankCompletionCandidates(candidates, signals, usage, {
          emptyQuery: intent.text.trim().length === 0,
        }).slice(0, request.limit);
        for (const item of items) {
          const document =
            context.documents.get(item.documentId) ??
            project.global.documents.get(item.documentId);
          if (!document) continue;
          const provider = this.providerFor(project, context, document.id);
          if (!provider) continue;
          context.issued.delete(document.id);
          context.issued.set(document.id, { document, provider });
          while (context.issued.size > 128)
            context.issued.delete(context.issued.keys().next().value!);
        }
        return {
          revision: result.revision,
          items,
          sources: [
            ...project.global.sources.values(),
            ...context.sources.values(),
          ].map(({ source, status, updatedAt, refreshing }) => ({
            source,
            status,
            refreshing: refreshing ?? false,
            ...(updatedAt !== undefined ? { updatedAt } : {}),
          })),
        };
      });
    } finally {
      this.release(project, context);
    }
  }

  async select(
    input: CompletionSelectionRequest,
  ): Promise<CompletionSelectionResponse> {
    const request = completionSelectionRequestSchema.parse(input);
    await this.deps.authorize(request);
    const { project, context } = this.acquire(request);
    try {
      // Issued results are scoped and bounded, independent of whichever small
      // overlay another concurrent conversation most recently activated.
      const issued = context.issued.get(request.documentId);
      if (!issued || issued.document.version !== request.expectedVersion)
        throw new Error("Completion expired or changed; search again");
      const { provider, document: known } = issued;
      const loaded =
        provider.accessSensitive || known.setEnabled
          ? await provider.load(context.scope)
          : [known];
      const current = ("documents" in loaded ? loaded.documents : loaded).find(
        (document) => document.id === request.documentId,
      );
      if (
        !current ||
        !validScope(context.scope, current) ||
        current.kind !== current.item.kind ||
        current.version !== request.expectedVersion
      )
        throw new Error("Completion changed; search again");
      if (
        current.item.available === false &&
        !(request.action === "disable" && current.item.canDisable)
      )
        throw new Error(
          current.item.unavailableReason ?? "Completion is unavailable",
        );
      if (request.action === "disable") {
        if (!current.setEnabled || !current.item.canDisable)
          throw new Error("Completion cannot be disabled");
        await current.setEnabled(false);
      } else if (current.item.enabled === false) {
        if (!current.setEnabled)
          throw new Error("Completion cannot be enabled");
        await current.setEnabled(true);
      }
      const cache =
        provider.scope === "conversation" ? context : project.global;
      if (
        current.setEnabled &&
        (request.action === "disable" || current.item.enabled === false)
      ) {
        await this.refresh(project, cache, provider, true);
        const updated = cache.documents.get(current.id);
        if (
          !updated ||
          (request.action === "select" && updated.item.available === false) ||
          updated.item.enabled !== (request.action === "select")
        )
          throw new Error(
            "Completion configuration did not become available; refresh settings",
          );
      }
      const selected = cache.documents.get(current.id) ?? current;
      context.issued.set(selected.id, { document: selected, provider });
      if (request.action === "select")
        await this.usage.record(
          project.projectId,
          completionUsageId(selected.kind, selected.id),
        );
      return {
        item: {
          ...selected.item,
          documentId: selected.id,
          version: selected.version,
        },
      };
    } finally {
      this.release(project, context);
    }
  }

  invalidate(
    providerId: string,
    scope?: Partial<CompletionScope>,
    hint?: CompletionInvalidation,
  ): void {
    if (this.closed) return;
    const provider = this.deps.providers.find(
      (candidate) => candidate.id === providerId,
    );
    if (!provider) return;
    for (const project of this.projects.values()) {
      if (scope?.projectId && project.projectId !== scope.projectId) continue;
      const caches =
        provider.scope === "conversation"
          ? [...project.contexts.values()].filter((context) =>
              scopeMatches(context.scope, scope),
            )
          : [project.global];
      for (const cache of caches) {
        const state = cache.sources.get(providerId)!;
        if (!invalidateCompletionProvider(state, hint)) {
          this.notify(project, cache);
          if (hasDemand(project, cache) && !state.pending)
            void this.refresh(project, cache, provider, true).catch(
              () => undefined,
            );
          continue;
        }
        if (provider.accessSensitive)
          void this.serial(project, async () => {
            if (cache.retired) return;
            const remove = [...state.ids];
            cache.stateSeeds.delete(provider.id);
            if (!remove.length) return;
            for (const id of remove) cache.documents.delete(id);
            project.units -= state.units;
            project.count -= state.count;
            state.units = 0;
            state.count = 0;
            cache.version++;
            this.notify(project, cache);
            if (provider.scope === "conversation") {
              state.ids.clear();
              if (project.activeContext === cache)
                await this.activate(project, cache);
            } else {
              // Keep installed IDs until removal succeeds, for safe retry cleanup.
              project.revision = (
                await (await project.index).update({ upsert: [], remove })
              ).revision;
              state.ids.clear();
            }
          }).catch(() => undefined);
        void this.refresh(project, cache, provider, true).catch(
          () => undefined,
        );
      }
    }
  }

  async dispose(projectId?: string): Promise<void> {
    if (projectId === undefined) {
      this.closed = true;
      this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    }
    const targets = [...this.projects.values()].filter(
      (project) => projectId === undefined || project.projectId === projectId,
    );
    const results = await Promise.allSettled(
      targets.map((project) => this.retire(project)),
    );
    if (projectId === undefined)
      results.push(...(await Promise.allSettled(this.retiring)));
    const failed = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failed.length)
      throw new AggregateError(
        failed.map((result) => result.reason),
        "Completion disposal failed",
      );
  }

  private newCache(
    scope: CompletionScope,
    providers: readonly CompletionProvider[],
  ): DocumentCache {
    return {
      scope,
      documents: new Map(),
      issued: new Map(),
      stateSeeds: new Map(),
      version: 0,
      active: 0,
      retired: false,
      sources: new Map(
        providers.map((provider) => [
          provider.id,
          {
            source: provider.id,
            status: "loading",
            generation: 0,
            expiresAt: 0,
            ids: new Set<string>(),
            units: 0,
            count: 0,
          },
        ]),
      ),
    };
  }
  private acquire(scope: CompletionScope): {
    project: ProjectIndex;
    context: DocumentCache;
  } {
    if (this.closed) throw new Error("Completion service is closed");
    let project = this.projects.get(scope.projectId);
    if (!project) {
      if (this.projects.size >= this.capacity) {
        const idle = [...this.projects.values()].find(
          (candidate) => candidate.active === 0,
        );
        if (!idle) throw new Error("Completion project capacity reached");
        void this.retire(idle).catch(() => undefined);
      }
      const create =
        this.deps.createIndex ??
        (async () => (await import("@nervekit/native")).createSearchIndex());
      const index = Promise.resolve().then(create);
      void index.catch(() => {
        const failed = this.projects.get(scope.projectId);
        if (failed?.index === index)
          void this.retire(failed).catch(() => undefined);
      });
      project = {
        projectId: scope.projectId,
        index,
        global: this.newCache(
          { projectId: scope.projectId },
          this.globalProviders,
        ),
        contexts: new Map(),
        nativeOverlay: new Map(),
        overlayVersion: -1,
        tail: Promise.resolve(),
        revision: 0,
        active: 0,
        units: 0,
        count: 0,
        retired: false,
      };
    }
    this.projects.delete(scope.projectId);
    this.projects.set(scope.projectId, project);
    if (project.active >= 32) throw new Error("Too many completion queries");
    const key = contextKey(scope);
    let context = project.contexts.get(key);
    if (!context) {
      if (project.contexts.size >= this.contextCapacity) {
        const idle = [...project.contexts.values()].find(
          (candidate) => candidate.active === 0,
        );
        if (!idle)
          throw new Error("Completion conversation cache capacity reached");
        this.evictContext(project, idle);
      }
      context = this.newCache(
        {
          projectId: scope.projectId,
          ...(scope.conversationId
            ? { conversationId: scope.conversationId }
            : {}),
        },
        this.contextProviders,
      );
    }
    project.contexts.delete(key);
    project.contexts.set(key, context);
    project.active++;
    context.active++;
    return { project, context };
  }
  private release(project: ProjectIndex, context: DocumentCache): void {
    project.active--;
    context.active--;
  }

  private evictContext(project: ProjectIndex, context: DocumentCache): void {
    project.contexts.delete(contextKey(context.scope));
    context.retired = true;
    for (const state of context.sources.values()) {
      project.units -= state.units;
      project.count -= state.count;
    }
    context.documents.clear();
    context.stateSeeds.clear();
    context.issued.clear();
    // At most a small overlay is removed; global files are never touched.
    if (project.activeContext === context)
      void this.serial(project, async () => {
        if (project.activeContext !== context) return;
        const remove = [...project.nativeOverlay.keys()];
        if (remove.length)
          project.revision = (
            await (await project.index).update({ upsert: [], remove })
          ).revision;
        project.nativeOverlay.clear();
        project.activeContext = undefined;
        project.overlayVersion = -1;
      }).catch(() => undefined);
  }

  private async activate(
    project: ProjectIndex,
    context: DocumentCache,
  ): Promise<void> {
    if (context.retired)
      throw new Error("Completion conversation cache retired");
    if (
      project.activeContext === context &&
      project.overlayVersion === context.version
    )
      return;
    // Capture before awaiting native work: an idle context may be evicted by a
    // new caller while a background overlay update is in flight.
    const snapshot = new Map(context.documents);
    const version = context.version;
    const upsert = [...snapshot.values()].filter(
      (document) =>
        project.nativeOverlay.get(document.id)?.version !== document.version,
    );
    for (const document of upsert)
      if (project.global.documents.has(document.id))
        throw new Error("Overlay collides with project document");
    const remove = [...project.nativeOverlay.keys()].filter(
      (id) => !snapshot.has(id),
    );
    if (upsert.length || remove.length)
      project.revision = (
        await (
          await project.index
        ).update({
          upsert: upsert.map(({ id, kind, fields }) => ({ id, kind, fields })),
          remove,
        })
      ).revision;
    project.activeContext = context;
    project.nativeOverlay = snapshot;
    project.overlayVersion = version;
  }

  private refresh(
    project: ProjectIndex,
    cache: DocumentCache,
    provider: CompletionProvider,
    wait: boolean,
  ): Promise<void> {
    const state = cache.sources.get(provider.id)!;
    const hasCached = () => state.count > 0;
    if (!wait && state.expiresAt > this.now()) return Promise.resolve();
    if (!state.pending) {
      if (this.activeLoads >= 32) {
        state.status = hasCached() ? "stale" : "unavailable";
        state.refreshing = false;
        return Promise.resolve();
      }
      this.activeLoads++;
      const generation = ++state.generation;
      const uncertainty = state.uncertainty ?? 0;
      state.status =
        state.updatedAt === undefined && !state.count ? "loading" : "stale";
      state.refreshing = true;
      const pending = Promise.resolve()
        .then(() => provider.load(cache.scope))
        .then((loaded) =>
          this.serial(project, async () => {
            if (cache.retired || state.generation !== generation) return;
            const snapshot = "documents" in loaded ? loaded : undefined;
            const documents = "documents" in loaded ? loaded.documents : loaded;
            const next = new Map<string, CompletionDocument>();
            let units = 0;
            for (const document of documents) {
              if (!validScope(cache.scope, document) || next.has(document.id))
                throw new Error("Invalid completion provider scope/identity");
              if (
                [...cache.sources].some(
                  ([source, other]) =>
                    source !== provider.id && other.ids.has(document.id),
                )
              )
                throw new Error("Duplicate completion identity");
              if (
                cache !== project.global &&
                project.global.documents.has(document.id)
              )
                throw new Error("Overlay collides with project document");
              units += unitsOf(document);
              if (next.size >= 1_000_000 || units > 64 * 1024 * 1024)
                throw new Error("Completion provider snapshot exceeds bounds");
              next.set(document.id, document);
            }
            if (
              project.count - state.count + next.size > 1_000_000 ||
              project.units - state.units + units > 64 * 1024 * 1024
            )
              throw new Error("Completion project metadata exceeds bounds");
            if (cache !== project.global) {
              const others = [...cache.sources.values()].filter(
                (other) => other !== state,
              );
              if (
                others.reduce((sum, other) => sum + other.count, next.size) >
                  10_000 ||
                others.reduce((sum, other) => sum + other.units, units) >
                  4 * 1024 * 1024
              )
                throw new Error(
                  "Completion conversation overlay exceeds bounds",
                );
            }
            const changed = [...next.values()].filter(
              (document) =>
                cache.documents.get(document.id)?.version !== document.version,
            );
            const remove = [...state.ids].filter((id) => !next.has(id));
            if (cache === project.global && (changed.length || remove.length))
              project.revision = (
                await (
                  await project.index
                ).update({
                  upsert: changed.map(({ id, kind, fields }) => ({
                    id,
                    kind,
                    fields,
                  })),
                  remove,
                })
              ).revision;
            project.count += next.size - state.count;
            project.units += units - state.units;
            for (const id of remove) cache.documents.delete(id);
            for (const [id, document] of next)
              cache.documents.set(id, document);
            cache.stateSeeds.set(
              provider.id,
              completionStateSeeds(next.values()),
            );
            state.ids = new Set(next.keys());
            state.count = next.size;
            state.units = units;
            if (changed.length || remove.length) cache.version++;
            // Commit before overlay sync; failed native writes stay dirty/fail closed.
            if (cache !== project.global && project.activeContext === cache)
              await this.activate(project, cache);
            if (cache.retired || project.retired) return;
            const uncertainAgain = (state.uncertainty ?? 0) !== uncertainty;
            state.status = uncertainAgain
              ? "stale"
              : (snapshot?.status ?? "fresh");
            state.refreshing = snapshot?.refreshing ?? false;
            state.updatedAt = snapshot
              ? snapshot.updatedAt
              : uncertainAgain
                ? state.updatedAt
                : this.now();
            state.expiresAt = uncertainAgain
              ? 0
              : this.now() +
                (state.status === "loading" || state.status === "stale"
                  ? Math.min(1000, provider.ttlMs)
                  : provider.ttlMs);
            this.notify(project, cache);
          }),
        )
        .catch(() => {
          if (
            cache.retired ||
            project.retired ||
            state.generation !== generation
          )
            return;
          state.status = hasCached() ? "stale" : "unavailable";
          state.refreshing = false;
          state.expiresAt =
            (state.uncertainty ?? 0) !== uncertainty
              ? 0
              : this.now() + Math.max(1000, provider.ttlMs);
          this.notify(project, cache);
        })
        .finally(() => {
          this.activeLoads--;
          const superseded = state.generation !== generation;
          if (!superseded) state.completedGeneration = generation;
          if (state.pending === pending) state.pending = undefined;
          if (
            (superseded ||
              ((state.uncertainty ?? 0) !== uncertainty &&
                hasDemand(project, cache))) &&
            !cache.retired &&
            !project.retired &&
            !this.closed
          )
            void this.refresh(project, cache, provider, true).catch(
              () => undefined,
            );
        });
      state.pending = pending;
    }
    const cached =
      (state.updatedAt !== undefined || state.count > 0) &&
      !provider.accessSensitive;
    return !wait && (provider.remote || cached)
      ? Promise.resolve()
      : settledCompletionProvider(state);
  }
  private providerFor(
    project: ProjectIndex,
    context: DocumentCache,
    id: string,
  ): CompletionProvider | undefined {
    return this.deps.providers.find((provider) =>
      (provider.scope === "conversation" ? context : project.global).sources
        .get(provider.id)
        ?.ids.has(id),
    );
  }
  private items(
    project: ProjectIndex,
    context: DocumentCache,
    result: SearchResult,
  ) {
    return result.items.flatMap((match) => {
      const document =
        context.documents.get(match.id) ??
        project.global.documents.get(match.id);
      if (!document || !validScope(context.scope, document)) return [];
      const item = document.item;
      if (item.kind !== document.kind)
        throw new Error("Invalid completion provider kind");
      const rangesFor = (fields: { index: number; offset: number }[]) =>
        fields
          .flatMap((display) =>
            match.matches
              .filter((field) => field.fieldIndex === display.index)
              .flatMap((field) =>
                field.ranges.map(([from, to]): [number, number] => [
                  from + display.offset,
                  to + display.offset,
                ]),
              ),
          )
          .sort((a, b) => a[0] - b[0]);
      return [
        {
          ...item,
          documentId: document.id,
          version: document.version,
          matchRanges: rangesFor(
            document.displayFields ??
              (document.displayField ? [document.displayField] : []),
          ),
          detailMatchRanges: rangesFor(document.detailFields ?? []),
          sortScore: match.lexicalScore + (document.stateBoost ?? 0),
          scoreFactors: {
            lexical: match.lexicalScore,
            context: 0,
            usage: 0,
            state: document.stateBoost ?? 0,
          },
        },
      ];
    });
  }
  private notify(project: ProjectIndex, cache: DocumentCache): void {
    if (project.retired || cache.retired) return;
    const contexts =
      cache === project.global ? [...project.contexts.values()] : [cache];
    for (const context of contexts)
      if (!context.retired)
        this.deps.changed?.({ ...context.scope, revision: project.revision });
  }
  private serial<T>(
    project: ProjectIndex,
    operation: () => Promise<T>,
  ): Promise<T> {
    const task = project.tail.then(() => {
      if (project.retired) throw new Error("Completion project retired");
      return operation();
    });
    project.tail = task.catch(() => undefined);
    return task;
  }
  private retire(project: ProjectIndex): Promise<void> {
    if (this.projects.get(project.projectId) === project)
      this.projects.delete(project.projectId);
    project.retired = true;
    project.global.retired = true;
    for (const context of project.contexts.values()) context.retired = true;
    const task = project.tail.then(async () => {
      const index = await project.index.catch(() => undefined);
      try {
        await index?.close();
      } finally {
        project.global.documents.clear();
        project.global.stateSeeds.clear();
        for (const context of project.contexts.values()) {
          context.documents.clear();
          context.issued.clear();
        }
        project.contexts.clear();
        project.nativeOverlay.clear();
      }
    });
    this.retiring.add(task);
    void task.finally(() => this.retiring.delete(task)).catch(() => undefined);
    return task;
  }
}
