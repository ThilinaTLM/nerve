import { createHash } from "node:crypto";
import {
  atlassianProfileHealthSchema,
  integrationHealthResultSchema,
  type AtlassianProfileHealth,
  type AtlassianService,
  type IntegrationHealthResult,
  type IntegrationHealthStatus,
} from "@nervekit/contracts/auth";
import type { AtlassianProfile } from "@nervekit/contracts/settings";
import { checkAtlassianConnection } from "@nervekit/tools/execution";
import { z } from "zod";

const NAMESPACE = "integration-health";
const SCOPE = "atlassian";
const services = ["jira", "confluence"] as const;

const storedResultSchema = integrationHealthResultSchema.extend({
  /** Fingerprint of the token that produced this evidence; never the token. */
  credentialDigest: z.string(),
});
type StoredResult = z.infer<typeof storedResultSchema>;
const storedHealthSchema = z.object({
  version: z.literal(1),
  jira: storedResultSchema.optional(),
  confluence: storedResultSchema.optional(),
});
type StoredHealth = z.infer<typeof storedHealthSchema>;

type DocumentStore = {
  readDocument<T>(
    namespace: string,
    scopeId: string,
    documentId: string,
  ): Promise<{ data: T; revision: number } | undefined>;
  writeDocument<T>(input: {
    namespace: string;
    scopeId: string;
    documentId: string;
    data: T;
    expectedRevision?: number;
  }): Promise<unknown>;
};

export type IntegrationHealthDeps = {
  store: DocumentStore;
  /** Atlassian profiles shown in user settings. */
  profiles: () => readonly AtlassianProfile[];
  getToken: (profileId: string) => Promise<string | undefined>;
  publish: (profileId: string) => Promise<void>;
  check?: typeof checkAtlassianConnection;
  now?: () => Date;
};

/**
 * Tracks whether each Atlassian profile's credentials currently work for Jira
 * and Confluence. Evidence comes from explicit checks and from real tool
 * calls. Each result is bound to the site, email, and token fingerprint that
 * produced it, so editing a profile or replacing its token invalidates it.
 */
export class IntegrationHealthService {
  readonly #queues = new Map<string, Promise<void>>();

  constructor(private readonly deps: IntegrationHealthDeps) {}

  async list(): Promise<AtlassianProfileHealth[]> {
    return Promise.all(
      this.deps.profiles().map((profile) => this.#current(profile)),
    );
  }

  async check(profileId: string): Promise<AtlassianProfileHealth> {
    const profile = this.deps.profiles().find((item) => item.id === profileId);
    if (!profile) throw new Error(`Atlassian profile ${profileId} not found.`);
    const token = await this.deps.getToken(profileId);
    if (!profile.siteUrl || !profile.email || !token)
      throw new Error(
        "Add the site URL, Atlassian email, and API token before testing this profile.",
      );
    const connection = {
      siteUrl: profile.siteUrl,
      email: profile.email,
      token,
    };
    const check = this.deps.check ?? checkAtlassianConnection;
    const results = await Promise.all(
      services.map(async (service) => {
        const outcome = await check(connection, service);
        return [service, outcome] as const;
      }),
    );
    for (const [service, outcome] of results)
      await this.#write(profile, token, service, {
        status: outcome.status,
        source: "check",
        message: outcome.message,
      });
    await this.deps.publish(profile.id);
    return this.#current(profile);
  }

  /**
   * Record evidence from a finished Jira/Confluence tool call. Only outcomes
   * that say something about the credentials change the status: success and
   * refused credentials (401). Permission, not-found, rate-limit, and server
   * failures are usually specific to one request and are ignored. `token` is
   * the credential the call actually used, so a token replaced mid-call never
   * inherits the old token's outcome.
   */
  async recordToolOutcome(input: {
    profile: AtlassianProfile;
    service: AtlassianService;
    token: string;
    errorCode?: string;
    message?: string;
  }): Promise<void> {
    const status: IntegrationHealthStatus | undefined =
      input.errorCode === undefined
        ? "verified"
        : input.errorCode === "JIRA_UNAUTHORIZED" ||
            input.errorCode === "CONFLUENCE_UNAUTHORIZED"
          ? "rejected"
          : undefined;
    if (!status || !input.profile.siteUrl || !input.profile.email) return;
    const previous = (await this.#read(input.profile.id))?.[input.service];
    // Avoid a store write and event for every successful call.
    if (
      previous?.status === status &&
      previous.credentialDigest === digest(input.token) &&
      previous.siteUrl === input.profile.siteUrl &&
      previous.email === input.profile.email
    )
      return;
    await this.#write(input.profile, input.token, input.service, {
      status,
      source: "tool",
      message: status === "verified" ? undefined : input.message,
    });
    await this.deps.publish(input.profile.id);
  }

  async #current(profile: AtlassianProfile): Promise<AtlassianProfileHealth> {
    const stored = await this.#read(profile.id);
    const token = stored ? await this.deps.getToken(profile.id) : undefined;
    const health: AtlassianProfileHealth = { profileId: profile.id };
    for (const service of services) {
      const result = stored?.[service];
      if (
        result &&
        token &&
        result.credentialDigest === digest(token) &&
        result.siteUrl === profile.siteUrl &&
        result.email === profile.email
      )
        health[service] = publicResult(result);
    }
    return atlassianProfileHealthSchema.parse(health);
  }

  async #read(profileId: string): Promise<StoredHealth | undefined> {
    const document = await this.deps.store.readDocument<unknown>(
      NAMESPACE,
      SCOPE,
      profileId,
    );
    const parsed = storedHealthSchema.safeParse(document?.data);
    return parsed.success ? parsed.data : undefined;
  }

  #write(
    profile: AtlassianProfile,
    token: string,
    service: AtlassianService,
    result: Pick<IntegrationHealthResult, "status" | "source" | "message">,
  ): Promise<void> {
    return this.#exclusive(profile.id, async () => {
      const document = await this.deps.store.readDocument<unknown>(
        NAMESPACE,
        SCOPE,
        profile.id,
      );
      const parsed = storedHealthSchema.safeParse(document?.data);
      const next: StoredHealth = parsed.success
        ? { ...parsed.data }
        : { version: 1 };
      next[service] = storedResultSchema.parse({
        status: result.status,
        source: result.source,
        ...(result.message ? { message: result.message.slice(0, 2000) } : {}),
        checkedAt: (this.deps.now?.() ?? new Date()).toISOString(),
        siteUrl: profile.siteUrl,
        email: profile.email,
        credentialDigest: digest(token),
      });
      await this.deps.store.writeDocument({
        namespace: NAMESPACE,
        scopeId: SCOPE,
        documentId: profile.id,
        data: next,
        expectedRevision: document?.revision ?? 0,
      });
    });
  }

  #exclusive(key: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.catch(() => undefined);
    this.#queues.set(key, tail);
    return result.finally(() => {
      if (this.#queues.get(key) === tail) this.#queues.delete(key);
    });
  }
}

function publicResult(result: StoredResult): IntegrationHealthResult {
  return integrationHealthResultSchema.parse({
    status: result.status,
    checkedAt: result.checkedAt,
    source: result.source,
    siteUrl: result.siteUrl,
    email: result.email,
    ...(result.message ? { message: result.message } : {}),
  });
}

function digest(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}
