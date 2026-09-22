---
title: Architecture checks and validation
description: Understand Nerve's automated boundaries and validation workflow.
---

Nerve treats architecture rules as executable policy where practical. The root `pnpm check` command runs formatting, ESLint, package-boundary checks, and package-specific type checks. Tests and release smoke tests cover behavior separately from these static checks.

## Enforced architecture

The workspace has an allowlisted, acyclic package dependency graph. Additional checks protect:

- transport- and framework-neutral contracts;
- the port-driven `workbench-server/src/domains/runs/runtime` state machine from transports, persistence implementations, UI, and process drivers;
- thin protocol/HTTP adapters;
- frontend presentation and feature ownership;
- public package export surfaces;
- shared CSS and theme-token conventions.

The server rule above is deliberately specific to run runtime. Concrete domain repositories and application services may use server infrastructure where their documented ownership requires it. Do not infer a blanket domain-to-infrastructure prohibition.

`@nervekit/ui-kit` intentionally exports Svelte and TypeScript source. Vite/Svelte consumers compile those components in their own pipeline, while package-boundary and style checks keep the source surface independent of product features. Other shared runtime packages generally publish compiled `dist` entrypoints.

## Behavioral validation

For package-scoped changes, run:

```sh
pnpm fix && pnpm check && pnpm run test:affected
```

For root, workspace, or test-infrastructure changes, replace the last command with `pnpm run test:full`. Release work additionally validates built package exports and artifact smoke tests. Use fresh temporary `NERVE_HOME`, explicit ports, and a separate Electron `userData` profile for tests that launch a runtime.

Generate source-mapped TypeScript coverage with `pnpm test:coverage`. The report is written to `coverage/` and intentionally excludes generated files, declarations, fixtures, Rust, and Svelte template execution. Packages or surfaces outside that measurement are unmeasured, not implicitly 100% covered. Coverage is review evidence rather than a global numeric gate.

Browser tests use a separate root-level Playwright suite because they orchestrate both the server and workbench packages. They must use a fresh temporary `NERVE_HOME`, explicit loopback ports, and no paid provider credentials.

Prefer tests of observable behavior and owning-layer invariants over tests of static exports, pass-through adapters, or cosmetic markup.
