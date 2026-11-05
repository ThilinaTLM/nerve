---
title: Hosted server (reverse proxy)
description: Run the Nerve daemon on a server behind Caddy or nginx with passkey owner login.
sidebar:
  order: 8
---

Nerve can run on a server and be opened from any browser. The daemon exposes shell and file access, so whoever signs in owns the machine. Hosted servers are **reverse-proxy only**: the daemon stays bound to loopback (or a private interface) and Caddy, nginx or Traefik terminates TLS with a real certificate. There is no built-in TLS or ACME for servers.

:::danger[Do not expose the daemon port directly]
Never publish port 43967 (or your `--port`) to the Internet. Device credentials are refused over plaintext, but the proxy is what gives you TLS, a stable origin and a single audited entry point. Firewall the daemon port to the proxy.
:::

## Configure Nerve

Set the public origin and, if the proxy is not on the same host, the proxy's address or CIDR range:

```sh
NERVE_PUBLIC_URL=https://nerve.example.com \
NERVE_TRUST_PROXY_PEERS=127.0.0.1,::1 \
node dist/main.js
```

| Setting                                                | Meaning                                                                                                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `network.publicUrl` / `NERVE_PUBLIC_URL`               | The externally visible origin. It is the passkey relying-party ID and origin, an accepted `Host`, and the cookie scope. Setting it turns on the owner passkey gate.                                                                                    |
| `network.trustProxy.peers` / `NERVE_TRUST_PROXY_PEERS` | Proxy peer addresses or CIDR ranges (e.g. `172.17.0.0/16` for a Docker bridge). Default `127.0.0.1`, `::1`. `X-Forwarded-For/Proto/Host` are read **only** from these peers and only while `publicUrl` is set. There is no "trust the first hop" mode. |

The proxy must pass the original `Host` (or `X-Forwarded-Host` equal to the `publicUrl` host), set `X-Forwarded-Proto: https` and `X-Forwarded-For`, and support WebSocket upgrades on `/ws/*` with long idle timeouts. The daemon refuses its local credential whenever forwarding headers are present, so a proxy on the same host never gains local access.

## Caddy

```caddyfile
nerve.example.com {
    reverse_proxy 127.0.0.1:43967
}
```

Caddy obtains the certificate, forwards `Host`, `X-Forwarded-*` and WebSocket upgrades by default.

## nginx

```nginx
server {
    listen 443 ssl http2;
    server_name nerve.example.com;
    # ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass http://127.0.0.1:43967;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

Use `$remote_addr` (not `$proxy_add_x_forwarded_for`) unless another trusted proxy sits in front of nginx.

## First sign-in: passkey setup

With `publicUrl` set and no passkey enrolled, the daemon accepts **no remote request** except enrollment. On start it prints a one-time **setup code** (valid 10 minutes):

```text
[nerve] Passkey setup code: ABCD-EFGH (valid 10 minutes). Open https://nerve.example.com/#pair=ABCD-EFGH. More: `nerve pair`.
```

Open the URL, register a passkey and you are signed in. Register at least two passkeys. `node dist/main.js pair --enroll` prints a fresh setup code from the host while the daemon runs.

After a passkey exists you can pair more devices (`node dist/main.js pair`, or **Settings → Devices**) or sign in with the passkey. Devices last 180 days or 30 idle days.

### Lost every passkey

On the server: `node dist/main.js access reset` clears the passkeys and prints a new setup code. There is deliberately no email or SMS recovery.

## Without `publicUrl`

Private deployments (LAN, VPN, tailnet) without `publicUrl` are **pairing-only**: devices are paired with one-time codes (see [LAN and mobile HTTPS](/operations/lan-mobile/)) and there is no passkey login. With `allowRemote` on, no TLS and no `publicUrl`, device credentials are refused over plaintext.

## Housekeeping

- **Audit trail:** `logs/access-audit.jsonl` records pair, login, failed, revoked and rotated events with IP and user agent, never secrets.
- **Revoke:** _Settings → Devices_, or "revoke all". Revoking closes the device's open sockets.
- **Rotate the local token:** the desktop/CLI trust root `secrets/daemon-token` can be rotated; connected local clients reconnect with the new value.
