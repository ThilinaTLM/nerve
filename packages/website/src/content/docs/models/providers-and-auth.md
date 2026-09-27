---
title: Providers and authentication
description: Understand Nerve's dynamic provider catalog, API keys, OAuth, and credential storage.
sidebar:
  order: 1
---

Nerve derives built-in provider capabilities from the installed pi-ai integration and exposes them through Workbench provider/model APIs. Treat what the installed Settings UI offers as the support boundary; internal transport code does not guarantee a tested product integration for every possible provider.

## Credential types

An API key uses the provider's developer API and its API billing. OAuth signs in to a provider account and may use subscription features or limits. The two methods are not interchangeable: a subscription does not supply an API key, and an API key does not unlock subscription-only features.

A provider stores one credential type at a time. Saving an API key replaces OAuth credentials, and completing OAuth replaces the API key. Browser API-key submission can use an RSA-OAEP/AES-GCM envelope before it reaches Nerve's encrypted secret store.

## OAuth login methods

The installed provider can offer one or more methods:

- **Browser callback:** open the login page and let the provider redirect to Nerve's local callback server.
- **Manual redirect:** while the prompt remains active, paste the final redirect URL or authorization code. For safety, pasted callback URLs must use a loopback host such as `localhost` or `127.0.0.1`; do not rewrite them to a LAN or public Nerve address.
- **Device code:** open the verification page and enter the displayed code. This is usually the simplest option when the browser and Nerve daemon run on different machines.

In a remote, SSH, container, or hosted environment, a browser callback to `localhost` reaches the browser's machine, not the remote daemon. Prefer device-code login when offered. Otherwise, copy the final loopback redirect URL from the browser address bar—even if the page failed to load—and paste it into the still-active Nerve prompt.

Only one active flow can use a given local callback address at a time. Cancel a stale conflicting flow before starting another. Authorization codes can be one-time and PKCE-bound; if a login is cancelled or fails during callback, TLS, proxy, or token exchange, start a fresh login instead of reusing a code or redirect URL.

## Current OAuth examples

Tests currently observe subscription metadata for Anthropic, GitHub Copilot, Kimi Coding, Meta, OpenAI Codex, OpenRouter, Radius, and xAI. This is not a frozen support matrix. Provider behavior, terms, and authentication options can change independently.

:::caution
Anthropic OAuth can use paid extra usage outside normal Claude plan limits. Nerve shows this warning in-product; verify usage with the provider.
:::

## Removing authentication

Removing a custom provider also removes its custom models and associated stored credential. Built-in provider credential removal makes its models unavailable until reauthenticated; stale scoped selections can remain visible as unavailable settings.

## Next steps

- [Select models and thinking](/models/selecting-models/)
- [Custom providers and models](/models/custom-providers/)
- [Provider troubleshooting](/troubleshooting/providers/)
