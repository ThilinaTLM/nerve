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

## Built-in extensions

An extension is a unit of capability with its own settings, accounts, and permissions. It contributes `quick_script` namespaces and optionally direct tools. The built-ins are Web Search, Atlassian, Diagrams, Image generation, and Image explanation; users manage them under [Extensions](/integrations/extensions/). Nerve doesn't load third-party extensions.

Each is one folder in `packages/extensions/src/<id>/`: a definition written with `@nervekit/extension-api` and method code that reaches the world only through its `ctx`. The definition declares:

- **Settings** as a small typed schema, from which the Settings page, scope rules (user, project, profile), defaults, and trust handling are generated.
- **Accounts** by kind (fields, secret label, auth scheme, credential origins). Extension code never sees the secret; `ctx.http` injects the credential on the host side and only for the account's own origins, on every redirect hop.
- **Namespaces**: a method table with a declared risk, operation name, and targets per method, plus declarations and doc topics that `sdk.describe` and `sdk.docs` serve to the agent.
- **Direct tools** such as `web_search` and `explain_image`, with a declarative card view.
- **Permissions**: the network origins it may reach and the host capabilities it uses (`models.image`, `models.vision`).

The package depends on `extension-api` and nothing else. The workbench server owns the list of built-ins (`builtinExtensions`), builds the registry from it, and reads the declared doc files. A repository check rejects any mention of an extension outside its folder and the built-in list, so permission rule sets select extension operations by risk (`external_read`, `external_write`), not by name. Settings live in `config/extensions.json` and accounts in `config/accounts.json` ([configuration](/operations/configuration/#extension-settings-and-accounts)). The runtime and nested authorization are described in the repository's `docs/architecture/code-mode.md` and `extension-platform.md`.

## Content extensions

Skills and AGENTS/SYSTEM resources extend instructions without code changes. Official disabled-by-default Nerve skills live in `@nervekit/workbench-server` (`src/builtin-skills/`); generic parsing and prompt formatting stay in `@nervekit/harness`, while executable capabilities stay in `@nervekit/tools`. Prompt suggestions add contextual reusable prompts and optional explicitly trusted predicates. These content sources require clear precedence and trust documentation.

## Package boundaries

Put transport-neutral contracts below hosts. Keep UI kit contract-free and Workbench presentation free of feature/application effects. Prefer one owning source over adapter-level compatibility shims.

## Next steps

- [Protocol extension details](/developers/protocol/v1/extension-model/)
- [Contributing](/developers/contributing/)
