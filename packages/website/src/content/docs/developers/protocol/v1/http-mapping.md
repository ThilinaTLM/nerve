---
title: HTTP mapping
sidebar:
  order: 8
---

HTTP RPC uses `ProtocolHttpRequest` and `ProtocolHttpResponse` from `@nervekit/contracts`. Requests carry the same catalog method, typed params, target, optional idempotency key, timeout, and lineage as WebSocket `request` messages. Responses carry either the catalog result or a typed protocol error and may include a snapshot cursor.

The workbench server dispatches HTTP protocol requests through its typed handler registry and enforces catalog target roles without changing method, params, idempotency key, timeout, or lineage. WebSocket RPC uses the same method handlers where both transports expose the operation.
Intentional non-RPC HTTP surfaces include browser bootstrap/client configuration, health/version, secret and credential submission, OAuth redirects and token exchange, binary upload/download, static web assets, and large file/log bodies. Those routes must still apply authentication, body limits, path validation, redaction, and no-secret logging.
