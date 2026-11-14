import type { ExtensionContext } from "@nervekit/extension-api";
import { jsonArray } from "../shared/http.js";
import { jiraConnection } from "../shared/session.js";
import { jiraRequest, type JiraConnection } from "./client.js";
import type { JiraFieldInfo } from "./issue.js";

/** The run's Jira state: the connection and the field list, loaded once per run. */
export class JiraSession {
  #fields: Promise<JiraFieldInfo[]> | undefined;

  constructor(
    readonly ctx: ExtensionContext,
    readonly connection: JiraConnection,
  ) {}

  static async create(ctx: ExtensionContext): Promise<JiraSession> {
    return new JiraSession(ctx, await jiraConnection(ctx));
  }

  /** Jira field list, loaded once per script run. */
  fields(): Promise<JiraFieldInfo[]> {
    return (this.#fields ??= jiraRequest(this.connection, {
      parse: jsonArray,
      path: "/field",
    }).then((raw) =>
      raw.map((item) => {
        const field = (item ?? {}) as Record<string, unknown>;
        const schema = (field.schema ?? {}) as Record<string, unknown>;
        const text = (value: unknown) =>
          typeof value === "string" ? value : null;
        return {
          id: String(field.id ?? ""),
          name: String(field.name ?? ""),
          custom: field.custom === true,
          type: text(schema.type),
          items: text(schema.items),
          kind: text(schema.custom) ?? text(schema.system),
        };
      }),
    ));
  }
}
