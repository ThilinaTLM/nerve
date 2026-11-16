---
title: Web search and fetch
description: Set up Tavily search and bounded web retrieval for the agent.
sidebar:
  order: 1
---

Agents can search the web and fetch pages. Search comes from the [Web Search extension](/integrations/extensions/#web-search); fetch is a core tool. Both are also available inside [Quick script](/guides/quick-script/) as `search.web` and `web.fetch`.

## Web search

1. Open **Settings → Extensions → Web Search** and add a Tavily account with your API key.
2. Choose it as the **Search account** and turn the extension on. The extension is off by default.

Search sends the query to Tavily. A call requests 1–20 results (default 5) and returns bounded titles, URLs, and snippets, shown as links in the tool card. If the extension is off or has no usable account, the agent doesn't get the tool, and the extension page shows what to fix. The Web Search switch in a conversation's tools control turns it off for that conversation only.

## Web fetch

Fetch retrieves an HTTP(S) URL, follows redirects, waits up to 60 seconds, and accepts at most 10 MiB. HTML is converted to Markdown. Raw mode, binary responses, and content unsuitable for bounded inline display are saved as artifacts.

Fetch has its own switch under **Settings → Tools** (**Web fetch**) and in the conversation's tools control. Both tools use outbound network access and retrieved content can contain untrusted instructions. Both are external reads: Read-only and Planning allow them, and Supervised asks first. Permissions control whether a call is allowed or approved; it does not make remote content trustworthy.

:::danger[Network boundary]
Do not use web fetch as an internal-network isolation mechanism. The executor accepts arbitrary URLs and redirects; Nerve does not currently document a URL allowlist or SSRF protection boundary.
:::

## Next steps

- [Extensions](/integrations/extensions/)
- [Agent permissions](/guides/agent-controls/)
- [Tool reference](/reference/tools/)
