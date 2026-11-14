import type { ExtensionContext } from "@nervekit/extension-api";
import { jsonObject } from "../shared/http.js";
import { orWhenUnsupported } from "../shared/errors.js";
import { confluenceConnection } from "../shared/session.js";
import { confluenceRequest, type ConfluenceConnection } from "./client.js";
import { valuesFromConfluenceList } from "./format.js";

/** The run's Confluence state: the connection and the space keys looked up so far. */
export class ConfluenceSession {
  readonly #spaceKeys = new Map<string, string>();

  constructor(
    readonly ctx: ExtensionContext,
    readonly connection: ConfluenceConnection,
  ) {}

  static async create(ctx: ExtensionContext): Promise<ConfluenceSession> {
    return new ConfluenceSession(ctx, await confluenceConnection(ctx));
  }

  /** Space keys by id, fetched lazily and cached per script run. */
  async spaceKeys(ids: string[]): Promise<Map<string, string>> {
    const missing = ids.filter((id) => !this.#spaceKeys.has(id));
    if (missing.length > 0) {
      const response = await confluenceRequest(this.connection, {
        parse: jsonObject,
        path: "/spaces",
        query: { ids: missing, limit: 250 },
      }).catch(orWhenUnsupported((): Record<string, unknown> => ({})));
      for (const raw of valuesFromConfluenceList(response)) {
        const space = raw as { id?: unknown; key?: unknown };
        if (space.id !== undefined && typeof space.key === "string") {
          this.#spaceKeys.set(String(space.id), space.key);
        }
      }
    }
    return this.#spaceKeys;
  }
}
