---
title: Web search and fetch
description: Enable Tavily search and bounded web retrieval for the agent.
sidebar:
  order: 1
---

`web_search` and `web_fetch` are optional agent tools and can be disabled independently in Settings.

## Web search

Search sends a query to Tavily and requires a configured Tavily API key. A call requests 1–20 results (default 5) and returns bounded titles, URLs, and snippets.

## Web fetch

Fetch retrieves an HTTP(S) URL, follows redirects, waits up to 60 seconds, and accepts at most 10 MiB. HTML is converted to Markdown. Raw mode, binary responses, and content unsuitable for bounded inline display are saved as artifacts.

Both tools use outbound network access and retrieved content can contain untrusted instructions. Tool policy controls whether the call is allowed or approved; it does not make remote content trustworthy.

:::danger[Network boundary]
Do not use web fetch as an internal-network isolation mechanism. The executor accepts arbitrary URLs and redirects; Nerve does not currently document a URL allowlist or SSRF protection boundary.
:::

## Next steps

- [Agent permissions](/guides/agent-controls/)
- [Tool reference](/reference/tools/)
