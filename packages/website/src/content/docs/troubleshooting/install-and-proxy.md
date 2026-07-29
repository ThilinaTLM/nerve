---
title: Install and proxy problems
description: Repair Electron downloads and configure corporate proxy or CA settings.
sidebar:
  order: 2
---

`pnpm install` can succeed while Electron's separate platform binary download fails.

## Configure the downloader

```sh
export ELECTRON_GET_USE_PROXY=true
export HTTPS_PROXY=http://proxy.example.com:8080
export HTTP_PROXY=$HTTPS_PROXY
export NO_PROXY=localhost,127.0.0.1,::1
export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem
pnpm --filter @nervekit/desktop-shell rebuild electron
pnpm desktop
```

PowerShell:

```powershell
$env:ELECTRON_GET_USE_PROXY = "true"
$env:HTTPS_PROXY = "http://proxy.example.com:8080"
$env:HTTP_PROXY = $env:HTTPS_PROXY
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:NODE_EXTRA_CA_CERTS = "C:\path\to\corporate-ca.pem"
pnpm --filter @nervekit/desktop-shell rebuild electron
pnpm desktop
```

Set `NODE_EXTRA_CA_CERTS` only for a real TLS-interception CA. If your company mirrors Electron artifacts, set `ELECTRON_MIRROR` before rebuild. Clear a partial Electron cache if the same corrupt download is reused.

Cache locations: `~/.cache/electron` on Linux, `~/Library/Caches/electron` on macOS, and `%LOCALAPPDATA%\electron\Cache` on Windows.

The desktop launcher adds loopback to proxy bypass. Use user-level pnpm proxy config rather than a repository `.npmrc` containing secrets. Run `NERVE_DEBUG_PROXY=1` for redacted diagnostics.

:::caution
Proxy URLs can contain credentials. Do not commit them or paste complete diagnostics into public issues.
:::

## Next steps

- [Platform problems](/troubleshooting/platform/)
- [Logs and diagnostics](/operations/diagnostics/)
