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

An extension is a unit of capability with its own settings, accounts, and permissions. It contributes `quick_script` namespaces and optionally direct tools. The built-ins are Web Search, Atlassian, Diagrams, Image generation, and Image explanation; users manage them under [Extensions](/integrations/extensions/). Users and projects can also install their own extensions as folders; see [Extension locations and trust](/reference/extensions/). The extension API is documented in the type declarations of the [`@nervekit/extension-sdk`](https://www.npmjs.com/package/@nervekit/extension-sdk) package, and the built-in **configure-nerve** skill (required by the Forge profile) builds extensions by chat.

Each is one folder in `packages/extensions/src/<id>/`: a definition written with `@nervekit/extension-api` and method code that reaches the world only through its `ctx`. The definition declares:

- **Settings** as a small typed schema, from which the Settings page, scope rules (user, project, profile), defaults, and trust handling are generated.
- **Accounts** by kind: fields, typed-in secrets (one or several), how they are sent (bearer, basic, header, or query parameter), credential origins, and a provider. Providers are typed-in secrets (the default), standard OAuth 2.0 (authorization code with PKCE, or device code, refreshed before it expires), or the extension's own **credential provider** for request signing (AWS SigV4), token exchanges (GitHub Apps), and other sign-in flows. Extension code never sees a credential: `ctx.http` adds it on the host side, only for the account's own origins, on every redirect hop. A credential provider is code in its own sandbox with no free network access (it reaches only its declared sign-in origins), and changing it asks you to allow the extension again. An extension can also declare that it **uses** a platform's accounts (for example every GitHub account), whichever extension defined them, with its own consent for the platform and scopes.
- **Namespaces**: a method table with a declared risk, operation name, and targets per method, plus declarations and doc topics that `sdk.describe` and `sdk.docs` serve to the agent.
- **Direct tools** such as `web_search` and `explain_image`, with a declarative card view.
- **Permissions**: the network origins it may reach and the host capabilities it uses (`models.image`, `models.vision`, `models.text`).

The package depends on `extension-api` and nothing else. The workbench server owns the list of built-ins (`builtinExtensions`), builds the registry from it, and reads the declared doc files. A repository check rejects any mention of an extension outside its folder and the built-in list, so permission rule sets select extension operations by risk (`external_read`, `external_write`), not by name. Settings live in `config/extensions.json` and accounts in `config/accounts.json` ([configuration](/operations/configuration/#extension-settings-and-accounts)). Declarations of every field and `ctx` service are in `packages/extension-api/src/types.ts`; the runtime and nested authorization are described in the repository's `docs/architecture/code-mode.md` and `extension-platform.md`.

## Content extensions

Skills and AGENTS/SYSTEM resources extend instructions without code changes. Official built-in Nerve skills live in `@nervekit/workbench-server` (`src/builtin-skills/`; all off by default; the `forge` profile requires `configure-nerve`); generic parsing and prompt formatting stay in `@nervekit/harness`, while executable capabilities stay in `@nervekit/tools`. Prompt suggestions add contextual reusable prompts and optional explicitly trusted predicates. These content sources require clear precedence and trust documentation.

## Package boundaries

Put transport-neutral contracts below hosts. Keep UI kit contract-free and Workbench presentation free of feature/application effects. Prefer one owning source over adapter-level compatibility shims.

## Next steps

- [Protocol extension details](/developers/protocol/v1/extension-model/)
- [Contributing](/developers/contributing/)
