# Nerve GPUI Workbench

An experimental GPUI workbench shell for Nerve.

This alpha is a disconnected interaction prototype. It does not start or connect to the Nerve daemon, read project files, or persist changes. Conversations, files, tasks, Git, pull request, context, and scratch-note content are placeholders.

Implemented shell interactions include:

- resizable left, right, and bottom panels;
- panel visibility controls and narrow-window side drawers;
- panel tab selection and counters;
- local content-tab add, close, and selection behavior;
- local scratch-note creation; and
- an embedded Nerve dark theme.

The supported Nerve product UI remains the Svelte workbench hosted by the browser and Electron desktop shell. This package is private, developer-only, and excluded from Nerve release artifacts.

## Run

GPUI currently supports macOS and Linux. Install the repository prerequisites and the platform dependencies required by GPUI, then run from the repository root:

```sh
pnpm gpui
```

## Validate

```sh
pnpm --filter @nervekit/gpui-workbench check
pnpm --filter @nervekit/gpui-workbench test
```
