---
title: Extension model
description: Add protocol operations/events, tools, skills, and suggestions at their owning layers.
sidebar:
  order: 7
---

## Protocol operations and events

1. Add domain request/result or event schemas in `packages/contracts`.
2. Register method/event metadata in the centralized catalog.
3. Add server handler, authorization, routing, and persistence behavior.
4. Add UI client/reducer behavior.
5. Negotiate capability where needed.
6. Test schema rejection, role/routing, idempotency/retry, replay/recovery, and security boundaries.

Protocol v1 does not accept aliases, raw/private frames, or breaking changes disguised as optional fields. Additive evolution must preserve strict parsing and negotiated behavior.

## Agent tools

Define tool name/schema/risk/execution mode in the owning manifest, implement a bounded executor or host adapter, integrate availability/policy, add presentation when generic rendering is insufficient, and test destructive/concurrent/error boundaries. Shared tool names belong in contracts.

## Content extensions

Skills and AGENTS/SYSTEM resources extend instructions without code changes. Prompt suggestions add contextual reusable prompts and optional explicitly trusted predicates. Both require clear precedence and trust documentation.

## Package boundaries

Put transport-neutral contracts below hosts. Keep UI kit contract-free and Workbench presentation free of feature/application effects. Prefer one owning source over adapter-level compatibility shims.

## Next steps

- [Protocol extension details](/developers/protocol/v1/extension-model/)
- [Contributing](/developers/contributing/)
