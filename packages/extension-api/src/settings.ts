/* Settings and account kinds of an extension. */
import type { ExtensionContext } from "./types.js";

// ── Settings and accounts ────────────────────────────────────────────────────

/**
 * Where a setting value can live: `user` (all projects), `project` (one project, used only once
 * the user trusts the project file) or `conversation`. `ctx.settings.get` resolves the manifest
 * default, then user, project and conversation; a narrower scope overrides a wider one.
 */
export type SettingScope = "user" | "project" | "conversation";

/** Members every setting field has, whatever its `type`. */
type FieldBase = {
  /** Name shown in the settings UI. Required, non-empty. */
  label: string;
  /** Help text under the label. */
  description?: string;
  /** Id of an entry of `SettingsSchema.sections` that groups the field. Absent: the default group. */
  section?: string;
  /** Scopes the field may be set in. Absent: all three. A value stored in another scope is rejected with a diagnostic. */
  scopes?: SettingScope[];
  /** Show the field only while the field named `field` (a key of this schema) equals `equals`. A hidden field keeps its stored value. */
  visibleWhen?: {
    /** Key of another field of this schema. */
    field: string;
    /** Value that field must have (`true`/`false` for a boolean field, the option `value` for an enum). */
    equals: string | boolean;
  };
  /** Put the field in the collapsed "Advanced" part of the settings UI. */
  advanced?: boolean;
};

/**
 * One setting of an extension, by `type`. Field keys (the names in `SettingsSchema.fields`)
 * are lower camelCase (`^[a-z][A-Za-z0-9]*$`, at most 64). Settings are not secret: a credential
 * belongs in an account kind.
 */
export type SettingField =
  | (FieldBase & {
      /** An on/off switch. */
      type: "boolean";
      /** Required: the value while no scope sets one. */
      default: boolean;
    })
  | (FieldBase & {
      /** Free text or a URL. */
      type: "string";
      /** Value while no scope sets one. Absent: `undefined`. */
      default?: string;
      /** `url` validates a URL; `text` (default) is plain text. */
      format?: "url" | "text";
      /** Hint shown in the empty input. */
      placeholder?: string;
      /** Most characters accepted (positive integer). */
      maxLength?: number;
    })
  | (FieldBase & {
      /** A number. */
      type: "number";
      /** Value while no scope sets one. Absent: `undefined`. */
      default?: number;
      /** Smallest accepted value. */
      min?: number;
      /** Largest accepted value. */
      max?: number;
      /** Increment of the UI control (positive). */
      step?: number;
      /** Unit shown beside the input (`ms`, `MB`). Display only. */
      unit?: string;
    })
  | (FieldBase & {
      /** One value of a fixed list. */
      type: "enum";
      /** Required: the `value` of one option. */
      default: string;
      /** At least one option. */
      options: {
        /** Stored value. */
        value: string;
        /** Name shown in the UI. */
        label: string;
        /** Help text of this option. */
        description?: string;
      }[];
    })
  | (FieldBase & {
      /**
       * Id of a user account of the given kind, or of any of several kinds (one
       * provider each; read `AccountInfo.kind` to tell them apart). Read it with
       * `ctx.accounts.selected(<field key>)`; `ctx.http` takes `auth: { account: <field key> }`.
       * Not allowed inside an account kind's own `fields`.
       */
      type: "account";
      /** Account kind (a key of `ExtensionDefinition.accounts`, of this or another extension), or a non-empty list of kinds. */
      kind: string | string[];
    })
  | (FieldBase & {
      /** A model the user picks (the host's model list). Not allowed inside an account kind's `fields`. */
      type: "model";
      /** Offer only models with this ability. Absent: any model. */
      capability?: "image" | "vision";
    });

/** The settings fields of an extension and how the UI groups them. */
export type SettingsSchema = {
  /** Groups for the settings UI; a field joins one through its `section`. */
  sections?: {
    /** Referenced by `SettingField.section`. */
    id: string;
    /** Heading in the UI. */
    title: string;
    /** Help text under the heading. */
    description?: string;
  }[];
  /** Settings by key (lower camelCase). The implicit `enabled` switch exists besides these and needs no field. */
  fields: Record<string, SettingField>;
};

/** The settings of an extension: a schema plus its version. */
export type ExtensionSettings = SettingsSchema & {
  /** Positive integer, starting at 1. Bump it when a field changes meaning, together with a migration. */
  version: number;
  /**
   * `migrations[n]` converts version n-1 settings to version n, on read. Hook: written as `true`
   * in the manifest. Not allowed in installed (user or project) extensions.
   */
  migrations?: Readonly<
    Record<
      number,
      (settings: Record<string, unknown>) => Record<string, unknown>
    >
  >;
};

/** How `ctx.http` injects an account's credential. */
export type AccountAuth =
  | {
      /** `Authorization: Basic base64(<account field>:<secret>)`. */
      scheme: "basic";
      /** Key of the account field holding the user name (`email`). */
      user: string;
    }
  | {
      /** `Authorization: Bearer <secret>`. */
      scheme: "bearer";
    }
  | {
      /** The secret is sent as this header's value. */
      scheme: "header";
      /** Header name: letters, digits and hyphens (`X-Api-Key`). */
      name: string;
    };

/** An account the user added in Settings, as an extension sees it. The secret is never part of it. */
export type AccountInfo = {
  /** Id of the account, local to the user's Nerve home. */
  id: string;
  /** Name the user gave it. */
  name: string;
  /** The account kind (a key of `ExtensionDefinition.accounts`). */
  kind: string;
  /** The kind's non-secret fields as the user filled them (`{ site: "https://acme.atlassian.net" }`). */
  fields: Record<string, unknown>;
};

/**
 * What a kind's `test` hook reports. A failure says why when it can:
 * `rejected` (credentials refused, the default), `restricted` (authenticated
 * without access), `unavailable` (the service is not provided) or
 * `unreachable` (network or server failure; the credentials could not be judged).
 * A `test` hook throws `ExtensionError("BAD_REQUEST")` when the account lacks
 * what the test needs (a site URL).
 */
export type AccountTestResult =
  | {
      /** The credentials work. */
      ok: true;
      /** Shown to the user (what was reached, who the account is). */
      message?: string;
    }
  | {
      /** The credentials do not work. */
      ok: false;
      /** What failed, shown to the user. */
      message: string;
      /** What the user can do about it. */
      fix?: string;
      /** Why it failed; default `rejected`. */
      reason?: "rejected" | "restricted" | "unavailable" | "unreachable";
    };

/**
 * The plain-data part of an account kind. The user adds accounts of the kind in Settings; the
 * extension never sees the secret, `ctx.http` injects it.
 */
export type AccountKindData = {
  /** Name of the kind in the account dialog (`Jira account`). Non-empty. */
  label: string;
  /** Non-secret fields stored with the account. Types `string`, `number`, `boolean` and `enum` only (not `account` or `model`). */
  fields: Record<string, SettingField>;
  /** The one secret of an account (token, password), kept in the secret store. */
  secret: {
    /** Name of the secret input (`API token`). Non-empty. */
    label: string;
    /** Help text under the input, e.g. where to create the token. */
    help?: string;
  };
  /** How `ctx.http` sends the secret. Absent: the kind has no injected credential and `HttpRequest.auth` is rejected. */
  auth?: AccountAuth;
  /**
   * Origins the credential is sent to: URL origins, with `{<field>}`
   * templates filled from the account's fields (`{site}`). A request with
   * `auth` to any other origin is denied; redirects are checked per hop.
   */
  origins?: string[];
};

/** An account kind: its data plus an optional test hook. Kind names are unique across all extensions. */
export type AccountKind = AccountKindData & {
  /**
   * Hook behind the "Test" button in Settings; written as `true` in the manifest. `ctx` is bound to
   * the tested account: every `account` setting of this kind selects it, so a `ctx.http.request`
   * with `auth: { account: <that setting key> }` signs in with its credential. Settings, artifacts
   * and `ctx.report` are not available. Throw `ExtensionError("BAD_REQUEST")` when the account
   * lacks a field the test needs.
   */
  test?: (
    account: AccountInfo,
    ctx: ExtensionContext,
  ) => Promise<AccountTestResult>;
};
