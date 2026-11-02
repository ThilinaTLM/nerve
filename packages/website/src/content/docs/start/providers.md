---
title: Connect a model
description: Sign in to a provider or add an API key, then choose your default model.
sidebar:
  order: 3
---

Connect at least one model provider so the agent has a model to use.

## Connect a provider

1. Open **Settings → Connections**, or start the **Connect a model provider** guide from Discover.
2. Under **Subscriptions**, choose **Connect subscription** and sign in. Or, under **API keys**, choose **Add API key** and paste your key.
3. Choose a default model and thinking level in the composer or in Settings.

A provider uses one sign-in method at a time. Saving an API key replaces a subscription sign-in for that provider, and signing in replaces the key.

Running a local model or a self-hosted endpoint? Add it as a [custom provider](/models/custom-providers/).

:::caution[Provider terms and billing apply]
A subscription sign-in doesn't make usage free. For Anthropic, Nerve warns that OAuth use may incur paid extra usage outside normal Claude plan limits. Check the provider's terms and usage dashboard.
:::

## Choose models

- Set a default model and thinking level once, then change them per conversation from the composer. A change made during a run applies to the next model request.
- Use a scoped list to keep the model picker short. An empty list shows every authenticated model.
- Thinking levels depend on the model. The picker offers only the levels the selected model supports.

## Good to know

- Voice input needs a ChatGPT (OpenAI Codex) sign-in. An ordinary OpenAI API key isn't enough. See [Images and voice](/guides/images-and-voice/).
- Some providers show only part of their model list. If a model you need is missing, add a [custom model](/models/custom-providers/).

## Next steps

- [Open a project](/start/first-project/)
- [Sign-in methods and remote machines](/models/providers-and-auth/)
- [Select models and thinking](/models/selecting-models/)
- [Troubleshoot providers](/troubleshooting/providers/)
