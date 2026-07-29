---
title: Providers and authentication
description: Understand Nerve's dynamic provider catalog, API keys, OAuth, and credential storage.
sidebar:
  order: 1
---

Nerve derives built-in provider capabilities from the installed pi-ai integration and exposes them through Workbench provider/model APIs. Treat what the installed Settings UI offers as the support boundary; internal transport code does not guarantee a tested product integration for every possible provider.

## Credential types

A provider stores either an API key or OAuth credentials. Browser API-key submission can use an RSA-OAEP/AES-GCM envelope before it reaches the secret store. Server-side credentials use Nerve's encrypted secret provider. Replacing authentication changes the credential type atomically.

OAuth can involve a browser callback, device code, pasted code, or provider-specific choice. Only one callback-server flow can run at a time for Anthropic, OpenAI Codex, and Radius. Cancel a stale flow before starting another.

Never reuse a possibly PKCE-bound authorization code after a TLS/proxy failure; restart the flow.

## Current OAuth examples

Tests currently observe subscription metadata for Anthropic, GitHub Copilot, Kimi Coding, OpenAI Codex, OpenRouter, Radius, and xAI. This is not a frozen support matrix. Provider behavior, terms, and authentication options can change independently.

:::caution
Anthropic OAuth can use paid extra usage outside normal Claude plan limits. Nerve shows this warning in-product; verify usage with the provider.
:::

## Removing authentication

Removing a custom provider also removes its custom models and associated stored credential. Built-in provider credential removal makes its models unavailable until reauthenticated; stale scoped selections can remain visible as unavailable settings.

## Next steps

- [Select models and thinking](/models/selecting-models/)
- [Custom providers and models](/models/custom-providers/)
- [Provider troubleshooting](/troubleshooting/providers/)
