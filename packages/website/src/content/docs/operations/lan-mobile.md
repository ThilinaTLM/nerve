---
title: LAN and mobile HTTPS
description: Opt into trusted-LAN access, install the local CA, and protect token URLs.
sidebar:
  order: 2
---

Nerve refuses a non-loopback bind unless remote access is explicitly allowed.

```sh
npx @nervekit/desktop -- --host 0.0.0.0 --allow-remote
```

For mobile browsers, add self-signed HTTPS:

```sh
npx @nervekit/desktop -- --host 0.0.0.0 --allow-remote --mobile-https
```

HTTP defaults to 3747 and mobile HTTPS to 3748. The tray exposes setup/share URLs and the local certificate-authority download.

## Trust the local CA

Nerve creates a stable local CA and host-aware leaf certificate under `<NERVE_HOME>/tls`. On POSIX systems the directory/key use restrictive modes, but Windows authorization relies on ACLs rather than POSIX mode bits.

Install the CA only on devices you control and verify the source device. Leaf certificates rotate when host names/addresses change while the CA remains reusable.

## Token bootstrap

A shared UI URL contains the daemon token. The server exchanges `?token=...` for a Strict, HttpOnly cookie and redirects to remove the query. APIs accept Bearer token or cookie; WebSockets can also bootstrap with a query token.

:::danger[The URL is a credential]
Do not put a token-bearing URL in screenshots, issue reports, chat, shell history, analytics, or an untrusted clipboard/history service. Self-signed HTTPS protects transport on a trusted LAN; it does not make public Internet exposure safe or repair a leaked token.
:::

Use firewall rules and a trusted network. Stop remote binding when it is no longer needed.

## Next steps

- [Security model](/operations/security/)
- [Connectivity troubleshooting](/troubleshooting/connectivity/)
