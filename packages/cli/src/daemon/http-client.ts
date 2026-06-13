import { readDaemonConnection } from "./connection.js";

async function apiJson<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const connection = await readDaemonConnection();
  const response = await fetch(`${connection.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${connection.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return apiJson<T>("GET", path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiJson<T>("POST", path, body);
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiJson<T>("PUT", path, body);
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiJson<T>("DELETE", path);
}
