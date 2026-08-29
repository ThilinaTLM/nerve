export class ApiRequestError extends Error {
  constructor(
    readonly status: number | undefined,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function apiBaseOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost";
}

export function apiPathSegment(value: string | number): string {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("API path segment must be a finite number.");
  }
  return encodeURIComponent(String(value));
}

export function normalizeApiPathForFetch(path: string): string {
  if (
    !(
      path === "/api" ||
      path.startsWith("/api/") ||
      path.startsWith("/api?")
    ) ||
    path.startsWith("//")
  ) {
    throw new Error("API requests must use a same-origin /api path.");
  }

  const url = new URL(path, apiBaseOrigin());
  if (url.origin !== apiBaseOrigin()) {
    throw new Error("API requests must stay on the current origin.");
  }
  if (!(url.pathname === "/api" || url.pathname.startsWith("/api/"))) {
    throw new Error("API requests must stay under /api.");
  }
  return `${url.pathname}${url.search}`;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) throw new Error(await response.text());
  if (!contentType.includes("application/json")) {
    const body = await response.text();
    throw new Error(
      `Expected JSON response from ${response.url || "API"}, received ${contentType || "unknown content type"}. ${body.slice(0, 80)}`,
    );
  }
  return (await response.json()) as T;
}

export async function fetchJson<T>(
  path: string,
  init: RequestInit & { method?: string } = {},
): Promise<T> {
  const requestPath = normalizeApiPathForFetch(path);
  const response = await fetch(requestPath, {
    credentials: "same-origin",
    ...init,
  });
  return await parseResponse<T>(response);
}

export async function apiGet<T>(path: string): Promise<T> {
  return fetchJson<T>(path);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function apiDelete<T>(path: string): Promise<T> {
  return fetchJson<T>(path, { method: "DELETE" });
}

export async function apiDeleteNoContent(path: string): Promise<void> {
  const requestPath = normalizeApiPathForFetch(path);
  const response = await fetch(requestPath, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await response.text());
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(
        result.includes(",") ? result.slice(result.indexOf(",") + 1) : result,
      );
    };
    reader.readAsDataURL(file);
  });
}

export function parseApiErrorBody(body: string): {
  code?: string;
  message?: string;
} {
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: unknown; message?: unknown };
    };
    return {
      code:
        typeof parsed.error?.code === "string" ? parsed.error.code : undefined,
      message:
        typeof parsed.error?.message === "string"
          ? parsed.error.message
          : undefined,
    };
  } catch {
    return {};
  }
}
