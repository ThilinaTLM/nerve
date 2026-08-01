# Nerve

[![CI](https://github.com/ThilinaTLM/nerve/actions/workflows/ci.yml/badge.svg)](https://github.com/ThilinaTLM/nerve/actions/workflows/ci.yml)
[![Website](https://github.com/ThilinaTLM/nerve/actions/workflows/website.yml/badge.svg)](https://github.com/ThilinaTLM/nerve/actions/workflows/website.yml)
[![Release](https://github.com/ThilinaTLM/nerve/actions/workflows/release.yml/badge.svg)](https://github.com/ThilinaTLM/nerve/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/%40nervekit%2Fdesktop?logo=npm)](https://www.npmjs.com/package/@nervekit/desktop)
[![License](https://img.shields.io/github/license/ThilinaTLM/nerve)](LICENSE)

**A transparent, local-first desktop coding harness with the focus of a small agent and the workflow of a complete workbench.**

Nerve keeps agent activity visible and gives you direct control over models, permissions, tools, approvals, Git, and background tasks while working with local projects.

[Website](https://nerve.tlmtech.dev/) · [Documentation](https://nerve.tlmtech.dev/start/overview/) · [Install guide](https://nerve.tlmtech.dev/start/install/) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

![Nerve desktop workbench showing a coding conversation, tool activity, and Git changes](packages/website/src/assets/shots/d1-conversation.webp)

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

- Follow streaming messages, reasoning, tool calls, plans, approvals, questions, logs, and task output.
- Change the model, thinking level, agent mode, and permission policy without restarting a conversation.
- Work with conversations, files, Git changes, pull requests, project notes, and background tasks in one workbench.
- Configure providers, tools, global skills, and project resources from the UI.
- Keep projects and Nerve state local by default, with opt-in browser, LAN, mobile, and remote-daemon workflows.

## Documentation

The website is the primary source for product and developer documentation:

- [Get started](https://nerve.tlmtech.dev/start/overview/)
- [Use the workbench](https://nerve.tlmtech.dev/guides/workbench/)
- [Configure and operate Nerve](https://nerve.tlmtech.dev/operations/configuration/)
- [Troubleshoot installation and runtime issues](https://nerve.tlmtech.dev/troubleshooting/)
- [Understand the architecture](https://nerve.tlmtech.dev/developers/architecture/)
- [Read the Protocol v1 reference](https://nerve.tlmtech.dev/developers/protocol/v1/)

## Develop from source

The repository requires Node.js 24 or newer and pnpm 11.17.0.

```sh
pnpm install
pnpm desktop
```

Use `pnpm dev` for the daemon and browser UI development servers. See the [development guide](https://nerve.tlmtech.dev/developers/development/) and [`CONTRIBUTING.md`](CONTRIBUTING.md) for the complete workflow. Release engineering details remain in [`docs/release.md`](docs/release.md).

## Support

If Nerve is useful to you, you can [support its continued development on Patreon](https://www.patreon.com/cw/thilinatlm).

## Contributing, security, and license

Contributions are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a change, and report vulnerabilities through the private channels in [`SECURITY.md`](SECURITY.md).

Nerve is licensed under Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
