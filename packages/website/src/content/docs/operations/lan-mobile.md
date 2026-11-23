---
title: LAN and mobile HTTPS
description: Opt into trusted-LAN access, install the local CA, and pair devices.
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

HTTP defaults to 3747 and mobile HTTPS to 3748. To pair a phone, use **Settings → Devices** (see [Pairing](#pairing)).

## Trust the local CA

Nerve creates a stable local CA and host-aware leaf certificate under `<NERVE_HOME>/tls`. On POSIX systems the directory/key use restrictive modes, but Windows authorization relies on ACLs rather than POSIX mode bits.

Install the CA only on devices you control and verify the source device. Leaf certificates rotate when host names/addresses change while the CA remains reusable.

## Pairing

Every phone or browser gets its own revocable **device credential**; the daemon token is never put in a URL or QR code. To add a device, open **Settings → Devices** on a signed-in client (or run `nerve pair` on the host) to get a one-time code. It is shown as text and as a QR code whose URL carries the code in the fragment: `https://<lan-ip>:3748/#pair=ABCD-EFGH`. If the host is on more than one network (home router, Tailscale, a VPN), the dialog lets you choose which address the QR code uses and remembers your choice; `nerve pair` prints all of them. Container and VM bridges are never offered. A network joined after the daemon started is offered once the daemon restarts, because its address must first be added to the certificate. A code is single use, lasts about two minutes, is invalidated after five wrong guesses, and is redeemed only over HTTPS (or on the host itself). Redeeming fails over plain HTTP from the LAN; use the mobile HTTPS listener.

The phone must trust the local CA before the HTTPS link works. For a phone that does not trust it yet, switch the dialog to **First time on this device**: the QR code then opens the HTTP bootstrap page `http://<lan-ip>:3747/mobile-setup#pair=ABCD-EFGH`, which installs the CA and then pairs. The page holds no secret, stays on the network you opened it through, and copies any `#pair=` fragment onto its "Open secure Nerve" link. Devices expire 180 days after pairing, or after 30 days without use, and must then be paired again. Revoke a device from **Settings → Devices**; its open connections are closed immediately.

Old `?token=` share links still work once per link: opening one over HTTPS mints a "Legacy link" device you can see and revoke, then redirects to the clean URL. Over plain HTTP the link is refused. Direct `Authorization: Bearer <daemon-token>` calls from non-loopback clients are still accepted for one more release (with a warning in the daemon log) and then removed.

The daemon also checks the `Host` header on every request and WebSocket upgrade (protection against DNS rebinding). Loopback names, the bound address, this machine's interface addresses (when bound to `0.0.0.0`), the mobile HTTPS hosts and the `network.publicUrl` host are accepted. To reach Nerve through another DNS name, list it in `NERVE_ALLOWED_HOSTS` (comma separated); other hosts get `421`.

:::danger[A pairing QR is a short-lived credential]
Do not share a pairing QR or code in screenshots, issue reports or chat while it is valid. A used or expired code is inert. Self-signed HTTPS protects transport on a trusted LAN; it does not make public Internet exposure safe.
:::

Use firewall rules and a trusted network. Stop remote binding when it is no longer needed.

## Private access with Tailscale

To use Nerve from your phone away from home, turn on **Settings → System → Network → Private access (Tailscale)**. Nerve serves itself through [Tailscale Serve](https://tailscale.com/kb/1312/serve) at `https://<machine>.<tailnet>.ts.net`, reachable only from devices on your tailnet. The certificate is a normal trusted one, so the phone needs no CA install, and Nerve itself keeps listening only on this computer: `--allow-remote` and mobile HTTPS are not needed.

You need Tailscale installed and signed in on the computer and the phone, with MagicDNS on. The first time, Nerve may ask you to:

- **Enable Serve for your tailnet.** Nerve shows a link to approve it, then **Try again**.
- **Allow Serve without sudo (Linux).** Run `sudo tailscale set --operator=$USER` once, then **Try again**. Nerve never runs `sudo` itself.

The first connection waits for Tailscale to issue the certificate (up to a minute, once). Then pair the phone as usual: **Pair a device** preselects the Tailscale address. Being on the tailnet grants nothing by itself; every phone still pairs and can be revoked.

Port 443 gives an address without a port number. If another service already uses it on Tailscale, Nerve leaves it alone and asks you to pick 8443 or 10000. Nerve only ever removes its own Serve entry, and refuses to run if Tailscale Funnel would make that entry public. Turning private access off, or quitting Nerve, removes the entry and disconnects phones using it immediately. While it runs, Nerve checks once a minute that the entry is still its own and not public, and stops serving if it is not.

## Next steps

- [Security model](/operations/security/)
- [Connectivity troubleshooting](/troubleshooting/connectivity/)
