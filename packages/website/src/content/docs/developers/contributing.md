---
title: Contribute
description: Make focused changes, test important boundaries, and report security issues safely.
sidebar:
  order: 9
---

Nerve is beta. Small, focused changes are easiest to reason about and review.

## Guidelines

- Keep shared API/event/policy/storage schemas in contracts and transport mechanics in protocol.
- Prefer clean ownership changes over compatibility shims.
- Add focused tests for public contracts, security/redaction, persistence/migrations, destructive operations, concurrency/state machines, recovery/failures, and complex orchestration.
- Avoid tests solely for static exports, pass-through adapters, cosmetic presentation, or already-covered behavior.
- Do not commit secrets, local state, generated release output, or machine-specific paths.
- Keep public copy concise and evidence-backed.

Follow package `AGENTS.md` instructions, especially Workbench presentation and shared design-system boundaries.

## Documentation changes

Public pages live in `packages/website/src/content/docs`. Repository engineering sources remain in root `docs/`. Update the evidence inventory when changing catalogs, limits, shortcuts, CLI flags, storage, or security-sensitive behavior.

## Security

Do not open a public issue for a suspected vulnerability. Email the maintainer or use a private GitHub security advisory as described in [SECURITY.md](https://github.com/ThilinaTLM/nerve/blob/main/SECURITY.md).

See the repository [CONTRIBUTING.md](https://github.com/ThilinaTLM/nerve/blob/main/CONTRIBUTING.md) for the canonical governance summary.

## Next steps

- [Development setup](/developers/development/)
- [Extension model](/developers/extensions/)
