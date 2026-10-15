# Nerve

[![CI](https://github.com/ThilinaTLM/nerve/actions/workflows/ci.yml/badge.svg)](https://github.com/ThilinaTLM/nerve/actions/workflows/ci.yml)
[![Release](https://github.com/ThilinaTLM/nerve/actions/workflows/release.yml/badge.svg)](https://github.com/ThilinaTLM/nerve/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/%40nervekit%2Fdesktop?logo=npm)](https://www.npmjs.com/package/@nervekit/desktop)
[![License](https://img.shields.io/github/license/ThilinaTLM/nerve)](LICENSE)

**A free, open-source coding workbench for AI agents — with parallel teammates and visible, steerable work.**

Run it on a supported AI subscription you already pay for, or your own API key. Delegate research and implementation to asynchronous subagents while you keep working. The harness loads applicable tools and guidance, bounds tool output, and automatically compacts long conversations.

Conversations, context, permissions, Git, pull requests, launch configurations, and background command logs share one workbench. Conversation history and work artifacts persist locally, with agent and command activity visible while work runs.

[Website](https://nerve.tlmtech.dev/) · [Documentation](https://nerve.tlmtech.dev/start/) · [Install guide](https://nerve.tlmtech.dev/start/install/) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="packages/website/src/assets/screenshots/desktop/conversation-dark.webp">
  <img src="packages/website/src/assets/screenshots/desktop/conversation-light.webp" alt="The Nerve desktop workbench showing a completed Bash result, profile-based subagent assignments, and the expanded Agents activity island">
</picture>

> [!NOTE]
> Nerve is beta software. It runs on Linux, Windows 11, and macOS and is distributed under the [Apache-2.0 license](LICENSE).

## Quick start

Nerve requires Node.js 24 or newer. Launch the latest published desktop app directly from npm:

```sh
npx @nervekit/desktop@latest
# or
pnpm dlx @nervekit/desktop@latest
```

The first launch may download Electron's platform binary. Nerve starts a local loopback daemon by default, and its application data stays under `~/.nerve`.

## Highlights

- **Focused context.** Applicable tools, project guidance, and skills shape each run. Bounded tool results keep large outputs out of the model context while retained artifacts remain available for inspection; automatic compaction helps long conversations continue.
- **Use the AI access you already have.** Sign in to a supported provider subscription over OAuth, or paste an API key. Credentials are stored encrypted on your machine and available models are exposed through the runtime catalog.
- **Steerable, branchable conversations.** Change the model, thinking level, agent mode, or permission rule set mid-conversation — it applies from the next provider request — and fork from any earlier entry without losing the original lineage.
- **Permissions enforced in policy, not prompts.** Read-only, supervised, and autonomous levels, planning mode, rule sets, and per-project or per-conversation overlays, evaluated before a tool runs.
- **Multiple projects and repositories.** Repositories are discovered beneath a workspace root, each with its own branch and working-tree state, Git operations, and GitHub pull requests.
- **Profile-based async subagents.** Use the built-in Explore profile for read-only research or Developer for implementation in the shared worktree. Named teammates retain context for follow-ups, report completion without polling, and can be configured through layered profiles.
- **Background work you can inspect.** Bash commands can run asynchronously with completion notices and dedicated log tabs. The conversation activity island brings agent and command status together; project launch configurations give recurring servers and watchers reusable start, stop, restart, and log controls.

A shared conversation core owns conversation execution and durable state for lead agents and subagents; the workbench server connects it to providers, tools, and the UI. See the [architecture guide](https://nerve.tlmtech.dev/developers/architecture/) for package and persistence boundaries.

Permission policy is Nerve's tool authorization and review layer, not an OS or container sandbox. Local-first is not offline-only: provider, Git, voice, web, and integration calls leave your machine when you use them.

## Documentation

The website is the primary source for product and developer documentation:

- [Get started](https://nerve.tlmtech.dev/start/)
- [Use the workbench](https://nerve.tlmtech.dev/guides/workbench/)
- [Configure and operate Nerve](https://nerve.tlmtech.dev/operations/configuration/)
- [Troubleshoot installation and runtime issues](https://nerve.tlmtech.dev/troubleshooting/)
- [Understand the architecture](https://nerve.tlmtech.dev/developers/architecture/)
- [Read the Protocol v1 reference](https://nerve.tlmtech.dev/developers/protocol/v1/)

## Develop from source

The repository requires Node.js 24 or newer, pnpm 11.20.0, and rustup; the Rust version is pinned in `rust-toolchain.toml`.

```sh
pnpm install
pnpm desktop:dev
```

Development defaults to disposable `data/storage-1` with a separate Electron profile; use `--slot N` for another slot. `pnpm storage:copy --slot N` copies a stopped `~/.nerve` into an unused slot for safe storage/migration testing. Only explicit `pnpm desktop:prod` uses real user data by default; installed desktop apps keep their `~/.nerve` default. Use `pnpm dev` for the daemon and browser UI development servers. See the [development guide](https://nerve.tlmtech.dev/developers/development/) and [`CONTRIBUTING.md`](CONTRIBUTING.md) for the complete workflow. Release engineering details remain in [`docs/runbooks/release.md`](docs/runbooks/release.md).

## Support

If Nerve is useful to you, starring the repository is the cheapest way to help other developers find it. You can also [support its continued development on Patreon](https://www.patreon.com/cw/thilinatlm).

## Contributing, security, and license

Contributions are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a change, and report vulnerabilities through the private channels in [`SECURITY.md`](SECURITY.md).

Nerve is licensed under Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

## Acknowledgements

Nerve's model routing, provider integrations, and streaming are built on
[@earendil-works/pi-ai](https://github.com/earendil-works/pi), a unified LLM API
client by Mario Zechner (MIT license).
