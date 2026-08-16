---
title: Connect a model provider
description: Authenticate a provider and choose default models and thinking levels.
sidebar:
  order: 3
---

Nerve gets its current built-in provider and model catalog through its pi-ai integration. The Workbench shows the providers and authentication methods available in the installed version; the underlying library's complete transport support is not automatically a Nerve product promise.

## Add authentication

Open **Providers & authentication** from the title bar, then use its **Connections** page to choose a provider. Model defaults and scopes live separately under **Settings**. Depending on provider metadata, Nerve can offer:

- an API key;
- an OAuth or subscription flow;
- both methods as alternatives.

A provider has one active credential type. Saving an API key replaces OAuth for that provider, and completing OAuth replaces its API key.

OAuth-capable options vary by release and provider. Current code exercises flows for Anthropic, GitHub Copilot, Kimi Coding, OpenAI Codex, OpenRouter, Radius, and xAI, but consult the installed provider dialog rather than treating this as a permanent support matrix.

:::caution[Provider terms and billing apply]
Subscription authentication does not make usage free. In particular, Nerve displays an Anthropic warning that OAuth use may incur paid extra usage outside normal Claude plan limits. Check the provider's terms and usage dashboard.
:::

## Pick defaults

After authentication, choose:

- a global default model and thinking level;
- an optional scoped list for the conversation picker;
- a separate default model and thinking level for Explore sub-agents.

An empty scope means all authenticated models. If a scoped model later disappears, Nerve retains it as unavailable but ignores it in the picker.

Thinking choices are model-dependent. Nerve's complete level vocabulary is `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; the runtime clamps a choice to levels the selected model reports supporting.

## During a conversation

The composer can change model and thinking level without recreating a conversation. If a run is active, the change applies to the **next model request**, not the request already streaming.

Some providers expose only the first eight models in Nerve's catalog. Full lists are currently enabled for a limited set of provider families. Add a [custom model definition](/models/custom-providers/) when a compatible model is not listed.

## Voice authentication is separate

Voice transcription requires OpenAI Codex/ChatGPT OAuth. An ordinary OpenAI API key is not enough. Audio is uploaded to ChatGPT's transcription service.

## Next steps

- [Built-in Guides](/start/guides/)
- [Open a project](/start/first-project/)
- [Provider and authentication details](/models/providers-and-auth/)
- [Troubleshoot providers](/troubleshooting/providers/)
