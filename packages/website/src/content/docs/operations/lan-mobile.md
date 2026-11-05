---
title: LAN and mobile HTTPS
description: Opt into trusted-LAN access, install the local CA, and protect token URLs.
sidebar:
  order: 2
---

Nerve refuses a non-loopback bind unless remote access is explicitly allowed.

```sh
npx @nervekit/desktop@latest -- --host 0.0.0.0 --allow-remote
```

For mobile browsers, add self-signed HTTPS:

```sh
npx @nervekit/desktop@latest -- --host 0.0.0.0 --allow-remote --mobile-https
```

HTTP defaults to 3747 and mobile HTTPS to 3748. When Nerve runs with **Close to system tray** turned on (**Settings → Workbench → Desktop**), the tray menu offers the setup and share URLs and the local certificate-authority download.

## Trust the local CA

Nerve creates a stable local CA and host-aware leaf certificate under `<NERVE_HOME>/tls`. On POSIX systems the directory/key use restrictive modes, but Windows authorization relies on ACLs rather than POSIX mode bits.

Install the CA only on devices you control and verify the source device. Leaf certificates rotate when host names/addresses change while the CA remains reusable.

## Token bootstrap

A shared UI URL contains the daemon token. The server exchanges `?token=...` for a Strict, HttpOnly cookie (30 days, renewed while in use; `Secure` over HTTPS) and redirects to remove the query. The mobile setup page signs the phone in itself, so its "Open secure Nerve" link carries no token. APIs and WebSockets accept a Bearer token or the cookie only; a query token is not accepted on WebSockets, and static pages no longer hand out the cookie on their own, so a plain browser on `localhost` needs a token URL once.

The daemon also checks the `Host` header on every request and WebSocket upgrade (protection against DNS rebinding). Loopback names, the bound address, this machine's interface addresses (when bound to `0.0.0.0`) and the mobile HTTPS hosts are accepted. To reach Nerve through another DNS name, list it in `NERVE_ALLOWED_HOSTS` (comma separated); other hosts get `421`.

:::danger[The URL is a credential]
Do not put a token-bearing URL in screenshots, issue reports, chat, shell history, analytics, or an untrusted clipboard/history service. Self-signed HTTPS protects transport on a trusted LAN; it does not make public Internet exposure safe or repair a leaked token.
:::

Use firewall rules and a trusted network. Stop remote binding when it is no longer needed.

## Next steps

- [Security model](/operations/security/)
- [Connectivity troubleshooting](/troubleshooting/connectivity/)
