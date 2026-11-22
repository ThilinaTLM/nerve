import { createServer, type Server } from "node:http";

/** What one authorization redirect must carry. */
export type LoopbackExpectation = {
  /** The `state` parameter the authorization request carried. */
  state: string;
  /** Path of the redirect URI. Default `/callback`. */
  path?: string;
};

/** A one-shot listener on 127.0.0.1 for the redirect of an authorization request. */
export type LoopbackListener = {
  /** The `redirect_uri` to send with the authorization request. */
  redirectUri: string;
  /** The authorization code; rejects with the service's error, or when closed first. */
  code: Promise<string>;
  close(): void;
};

const PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>Nerve</title><body style="font-family:system-ui;margin:3rem"><p>${message}</p>`;

/**
 * Listens for one request to the redirect path. A request with the wrong `state` is refused and
 * the listener keeps waiting; one with `error`, or the code, ends it. `signal` closes it.
 */
export async function listenForLoopbackRedirect(
  expected: LoopbackExpectation,
  signal?: AbortSignal,
): Promise<LoopbackListener> {
  const path = expected.path ?? "/callback";
  let settle!: { resolve(code: string): void; reject(error: Error): void };
  const code = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });
  // A listener nobody awaits (closed first) must not raise an unhandled rejection.
  code.catch(() => undefined);
  const close = () => {
    server.close();
    server.closeAllConnections();
    settle.reject(new Error("The sign-in redirect listener was closed."));
  };
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const reply = (status: number, message: string) => {
      response.writeHead(status, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(PAGE(message));
    };
    if (request.method !== "GET" || url.pathname !== path)
      return reply(404, "Not found.");
    if (url.searchParams.get("state") !== expected.state)
      return reply(
        400,
        "This sign-in link does not belong to the active sign-in.",
      );
    const error = url.searchParams.get("error");
    const authorization = url.searchParams.get("code");
    if (error) {
      reply(200, "Sign-in was refused. You can close this tab.");
      settle.reject(
        new Error(
          `The service refused the sign-in: ${error}${url.searchParams.get("error_description") ? ` (${url.searchParams.get("error_description")})` : ""}`,
        ),
      );
    } else if (authorization) {
      reply(200, "Signed in. You can close this tab and return to Nerve.");
      settle.resolve(authorization);
    } else return reply(400, "The redirect carried no authorization code.");
    server.close();
    server.closeAllConnections();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not listen for the sign-in redirect.");
  signal?.addEventListener("abort", close, { once: true });
  return {
    redirectUri: `http://127.0.0.1:${address.port}${path}`,
    code,
    close,
  };
}
