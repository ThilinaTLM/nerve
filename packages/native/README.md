# `@nervekit/native`

TypeScript façades over one Rust N-API addon. Consumers import only the package root; raw bindings and prebuild paths are private.

## Layout

| Path                                       | Contents                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `native/src/{git,monitor,process,search}/` | Plain Rust domain logic; N-API adapters live in each domain's `napi.rs`                             |
| `native/src/core/`                         | Shared mechanisms: Tokio runtime, cancellation, admission permit, handle registry, error categories |
| `native/src/api/`                          | Cross-domain composition (e.g. injecting Git reads into the monitor)                                |
| `src/<domain>/`                            | Public façades and the domain's private `binding.ts`                                                |
| `src/binding/`                             | Shared addon loader and the composed binding contract                                               |

Domains use only their own modules and `core`. `pnpm check:boundaries` (part of `pnpm check`) enforces this with a lexical scan; it does not resolve macros or `include!`.

## Domains

- **Process:** managed processes with bounded output, containment, inspection and termination. A permit is held for each process's lifetime; spawning at capacity rejects.
- **Git:** asynchronous repository, snapshot, ancestry and document reads via `gix`, with bounded output and categorized errors (`NativeOperationError`). Reads are not cancellable. Mutations stay with the Git CLI.
- **Monitor:** filesystem and Git change watching with bounded scopes, event coalescing and polling fallback. `close()` removes the handle and joins its worker.
- **Search:** in-memory lexical indexes for completion (below).

## Search

`createSearchIndex({ signal? })` creates a project-owned index of typed documents. Callers own IDs, kinds, permissions and freshness; native only matches and ranks.

```ts
const index = await createSearchIndex({ signal });
await index.update({
  upsert: [
    {
      id: "pr:271",
      kind: "pull-request",
      fields: [
        { key: "identifier", text: "271" },
        { key: "title", text: "fix memory leak" },
      ],
    },
  ],
  remove: [],
});
const { revision, items } = await index.query({ text: "271 fix", limit: 64 });
await index.close();
```

- **Updates** replace whole documents atomically and advance `revision` once. A failed update publishes nothing.
- **Queries** must match every term across a document's fields. Options: `kinds`, `limit` (default 64, max 256) and `documentIds` (at most 256, matched with the same rules; nothing non-matching is injected). An empty query returns neutral scores.
- **Results** return `lexicalScore` and per-field match `ranges` as UTF-16 half-open offsets into the original text. Ties prefer the shorter path, then ID.
- **Field weights:** `path` uses the file-path ranking; `name`/`identifier` 1.0, `title` 0.95, `description` 0.75. Context, usage and permission ranking belong to the caller.
- **Ordering:** one FIFO lane per index serializes updates and queries. Two separate queries are not atomic; compare their revisions.
- **Limits:** 200k documents, 400k fields, 64Mi UTF-16 source units, up to 32 fields per document, 32 terms per query. One active plus 32 waiting operations per index; updates also share a process-wide build gate (two active, 16 waiting). Exceeding a limit rejects; nothing is silently truncated. Limits bound logical input, not RSS.
- **Lifetime:** the creation signal owns the whole index. Aborting it or calling `close()` cancels active work, rejects queued work and frees memory on a native worker. Finalizers are only a fallback.

## Development

```sh
pnpm build:native   # release addon into prebuilds/local
pnpm test           # TS façade tests + cargo test
pnpm check          # boundaries, tsc, cargo fmt + clippy
```

Benchmarks and their methodology: [`test/search/`](test/search/search-query.benchmark.md), [`test/benchmarks/`](test/benchmarks/git-refresh.benchmark.md) and the server's [completion benchmarks](../workbench-server/test/benchmarks/). Results are synthetic and from Linux x64 only.
