---
title: Provider, model, and voice problems
description: Recover API-key and OAuth flows, find models, and restore voice transcription.
sidebar:
  order: 4
---

## API key fails

Verify the provider, key scope, endpoint, and whether a custom provider expects different headers or compatibility settings. Saving a key replaces OAuth for that provider. Reauthenticate rather than placing a key in prompts or logs.

## OAuth cannot complete

Only one callback-server flow can run at a time for selected providers. Cancel the active flow and restart. Corporate TLS/proxy failures can invalidate a PKCE-bound code; do not reuse it. Follow [install/proxy guidance](/troubleshooting/install-and-proxy/) and begin a fresh flow.

Anthropic subscription authentication may use paid extra usage outside plan limits. This warning is expected, not an authentication error.

## Expected model is missing

Authenticate the correct provider and clear/review model scope. Stale scoped entries show as unavailable and are ignored. Some provider catalogs expose only the first eight models. Define a compatible [custom model](/models/custom-providers/) if appropriate.

Thinking options are model metadata-dependent. A missing `xhigh` or `max` generally means the selected model does not declare it.

## Voice is unavailable

Voice requires OpenAI Codex/ChatGPT OAuth with account information, not an OpenAI API key. Confirm microphone permission, keep recordings under 8 minutes/25 MB, and use a supported browser audio type.

## Image request fails

The composer allows paste regardless of model modality. Select a model known to support image input; Nerve's picker does not currently enforce it.

## GitHub PRs are unavailable

This is not provider auth. Install `gh`, ensure a GitHub remote exists, and run `gh auth login`.
