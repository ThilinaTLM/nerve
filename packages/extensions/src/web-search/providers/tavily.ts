import {
  ExtensionError,
  type AccountInfo,
  type AccountTestContext,
  type AccountTestResult,
  type ExtensionContext,
  type HttpResponse,
} from "@nervekit/extension-api";
import {
  httpCode,
  parseJson,
  type SearchProvider,
  type SearchRequest,
  type SearchResponse,
} from "./provider.js";

const ORIGIN = "https://api.tavily.com";
const SEARCH_URL = `${ORIGIN}/search`;
const USAGE_URL = `${ORIGIN}/usage`;
const TEST_TIMEOUT_MS = 15_000;

type TavilySearch = {
  answer?: string;
  results?: {
    title: string;
    url: string;
    content: string;
    published_date?: string;
  }[];
};

async function search(
  ctx: ExtensionContext,
  { query, limit, includeAnswer, accountField }: SearchRequest,
): Promise<SearchResponse> {
  const response = await ctx.http.request({
    url: SEARCH_URL,
    method: "POST",
    auth: { account: accountField },
    body: {
      json: { query, max_results: limit, include_answer: includeAnswer },
    },
    response: "text",
    timeoutMs: 60_000,
  });
  if (!response.ok)
    throw new ExtensionError(
      httpCode(response.status),
      `Tavily API error: ${response.status} ${String(response.body)}`,
    );
  const data = parseJson(response.body, "Tavily") as TavilySearch;
  return {
    ...(data.answer ? { answer: data.answer } : {}),
    hits: (Array.isArray(data.results) ? data.results : []).map((hit) => ({
      title: hit.title,
      url: hit.url,
      content: hit.content,
      ...(hit.published_date ? { published: hit.published_date } : {}),
    })),
  };
}

type TavilyUsage = {
  key?: { usage?: number; limit?: number | null };
  account?: {
    current_plan?: string;
    plan_usage?: number;
    plan_limit?: number | null;
  };
};

const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Plan and credit use from Tavily's `GET /usage`: the key's own limit when it has one, else the plan's. */
function usageSummary(data: TavilyUsage): {
  message: string;
  exhausted: boolean;
} {
  const keyLimit = number(data.key?.limit);
  const usage =
    keyLimit === undefined
      ? number(data.account?.plan_usage)
      : number(data.key?.usage);
  const limit = keyLimit ?? number(data.account?.plan_limit);
  const plan = data.account?.current_plan;
  const parts = [
    ...(plan ? [`${plan} plan`] : []),
    ...(usage !== undefined
      ? [
          `${usage.toLocaleString("en-US")}${limit !== undefined ? ` / ${limit.toLocaleString("en-US")}` : ""} credits`,
        ]
      : []),
  ];
  return {
    message: parts.join(" · "),
    exhausted: usage !== undefined && limit !== undefined && usage >= limit,
  };
}

const failure = (status: number): Extract<AccountTestResult, { ok: false }> => {
  if (status === 401 || status === 403)
    return {
      ok: false,
      reason: "rejected",
      message: "Tavily rejected the API key.",
      fix: "Check the key at https://app.tavily.com.",
    };
  return {
    ok: false,
    reason: "unreachable",
    message: `Tavily answered ${status}; the key could not be checked.`,
  };
};

/** The kind's `test` hook: reads `/usage` with the account's key. */
async function test(
  _account: AccountInfo,
  ctx: AccountTestContext,
): Promise<AccountTestResult> {
  let response: HttpResponse;
  try {
    response = await ctx.http.request({
      url: USAGE_URL,
      auth: { account: "searchAccount" },
      response: "text",
      timeoutMs: TEST_TIMEOUT_MS,
    });
  } catch (error) {
    if (
      error instanceof ExtensionError &&
      (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN")
    )
      return failure(error.code === "UNAUTHORIZED" ? 401 : 403);
    return {
      ok: false,
      reason: "unreachable",
      message: "Could not reach Tavily.",
    };
  }
  if (!response.ok) return failure(response.status);
  let data: TavilyUsage;
  try {
    data = JSON.parse(String(response.body)) as TavilyUsage;
  } catch {
    return {
      ok: false,
      reason: "unreachable",
      message: "Tavily returned a response that is not JSON.",
    };
  }
  const { message, exhausted } = usageSummary(data);
  if (exhausted)
    return {
      ok: false,
      reason: "restricted",
      message: `Tavily credits are used up${message ? ` (${message})` : ""}.`,
      fix: "Wait for the plan to renew or upgrade it at https://app.tavily.com.",
    };
  return { ok: true, ...(message ? { message } : {}) };
}

export const tavilyProvider: SearchProvider = {
  kind: "tavily",
  account: {
    label: "Tavily account",
    fields: { name: { type: "string", label: "Name", maxLength: 128 } },
    secret: {
      label: "API key",
      help: "Get a Tavily API key at https://app.tavily.com.",
    },
    auth: { scheme: "bearer" },
    origins: [ORIGIN],
    test,
  },
  search,
};
