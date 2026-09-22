---
title: Code quality and architecture checks
description: Understand Nerve's automated boundaries, quality inventory, and validation workflow.
---

Nerve treats architecture rules as executable policy where practical. The root `pnpm check` command runs formatting, ESLint, package-boundary checks, and package-specific type checks. Tests and release smoke tests cover behavior separately; a passing line-count or lint report is not a substitute for those checks.

## Quality inventory

Run the deterministic source inventory from the repository root:

```sh
pnpm quality:report
pnpm quality:report -- --json
pnpm quality:report -- --output /tmp/nerve-quality.md
```

The report uses the same tracked and non-ignored source inventory as the architecture checks. It separates production and test code, includes the Rust crate, excludes generated/build/prebuilt artifacts, lists package test commands, and identifies a small set of syntactic review signals.

Line counts, lint suppressions, and type assertions identify places worth reviewing. They are not quality scores, coverage measurements, or evidence of a defect. Compare reports only when generated with the same revision and toolchain.

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
