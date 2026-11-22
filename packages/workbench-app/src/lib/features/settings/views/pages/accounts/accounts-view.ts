import type {
  AccountKind,
  ExtensionIcon,
} from "@nervekit/contracts/extensions";
import type {
  AccountLevel,
  AccountState,
  AccountView,
} from "@nervekit/contracts/settings";

/**
 * What the Accounts page derives from the accounts, the kinds and the extensions that define
 * them: the rows, the search over them, and the level moves each account allows.
 */

/** The extension that defines a kind. */
export type AccountExtension = {
  id: string;
  name: string;
  icon: ExtensionIcon;
  /** Defined by the open project's own extension: its accounts stay in that project. */
  projectOnly: boolean;
};

export type AccountRowModel = {
  account: AccountView;
  /** Absent when no registered extension defines the account's kind. */
  kind?: AccountKind;
  extension?: AccountExtension;
};

const levelLabels: Record<AccountLevel, string> = {
  user: "User",
  project: "Project",
};
const stateLabels: Record<AccountState, string> = {
  ready: "Ready",
  needs_sign_in: "Needs sign-in",
  failed: "Failed",
  unavailable: "Unavailable",
};
export const accountStateLabel = (state: AccountState): string =>
  stateLabels[state];

/** What a search matches for a row; `projectName` names the open project's level. */
export function accountSearchText(
  row: AccountRowModel,
  projectName?: string,
): string {
  const { account } = row;
  return [
    account.name,
    row.kind?.label ?? account.kind,
    account.kind,
    row.kind?.platform,
    row.extension?.name,
    levelLabels[account.level],
    account.level === "project" ? projectName : undefined,
    stateLabels[account.state],
    accountSummary(row),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const words = (query: string): string[] =>
  query.toLowerCase().split(/\s+/).filter(Boolean);

/** Rows matching every word of the query, case-insensitively; a blank query matches all. */
export function searchAccountRows(
  rows: readonly AccountRowModel[],
  query: string,
  projectName?: string,
): AccountRowModel[] {
  const terms = words(query);
  if (terms.length === 0) return [...rows];
  return rows.filter((row) => {
    const text = accountSearchText(row, projectName);
    return terms.every((term) => text.includes(term));
  });
}

/**
 * The accounts the page lists: every user-level one and those of the open project. Accounts of
 * other projects belong to those projects' own settings.
 */
export function visibleAccounts(
  accounts: readonly AccountView[],
  projectId: string | undefined,
): AccountView[] {
  return accounts.filter(
    (account) =>
      account.level === "user" ||
      (projectId !== undefined && account.projectId === projectId),
  );
}

export function accountRows(
  accounts: readonly AccountView[],
  kinds: readonly AccountKind[],
  extensionOf: (kind: string) => AccountExtension | undefined,
): AccountRowModel[] {
  return accounts.map((account) => {
    const kind = kinds.find((candidate) => candidate.kind === account.kind);
    const extension = extensionOf(account.kind);
    return {
      account,
      ...(kind ? { kind } : {}),
      ...(extension ? { extension } : {}),
    };
  });
}

/** The level moves and copies an account offers; the server still has the last word. */
export type AccountLevelChoices = {
  /** Where Move goes; absent when the account cannot move. */
  move?: AccountLevel;
  duplicate: AccountLevel[];
};

export function levelChoices(
  row: AccountRowModel,
  projectId: string | undefined,
): AccountLevelChoices {
  const toUser = row.extension?.projectOnly !== true;
  const toProject = projectId !== undefined;
  const move: AccountLevel | undefined =
    row.account.level === "user"
      ? toProject
        ? "project"
        : undefined
      : toUser
        ? "user"
        : undefined;
  return {
    ...(move ? { move } : {}),
    duplicate: [
      ...(toUser ? (["user"] as const) : []),
      ...(toProject ? (["project"] as const) : []),
    ],
  };
}

/**
 * What to tell before duplicating an account that is signed in through the provider: both copies
 * share one refresh token, and the service may rotate it.
 */
export function duplicateWarning(
  row: AccountRowModel,
  signsIn: boolean,
): string | undefined {
  if (!signsIn || row.account.state !== "ready") return undefined;
  return `“${row.account.name}” is signed in. The copy shares its sign-in; when the service rotates the refresh token, whichever copy refreshes first signs the other out, and that one needs to sign in again.`;
}

/** The account's status line when it is not ready. */
export function accountProblem(account: AccountView): string | undefined {
  switch (account.state) {
    case "needs_sign_in":
      return account.error ?? "Needs credentials";
    case "failed":
      return account.error ?? "The credential does not work";
    case "unavailable":
      return account.error ?? "Its extension is off or gone";
    case "ready":
      return undefined;
  }
}

/** The first filled field of an account in its kind's order, e.g. the site URL. */
export function accountSummary(row: AccountRowModel): string | undefined {
  for (const key of Object.keys(row.kind?.fields ?? {})) {
    const value = row.account.fields[key];
    if (key !== "name" && typeof value === "string" && value) return value;
  }
  return undefined;
}

/**
 * The sign-in hook of the Accounts page. Whoever implements the OAuth sign-in passes it to
 * `AccountsSettingsPage`; without it no row offers Sign in.
 */
export type AccountSignIn = {
  /** Whether accounts of this kind sign in through a provider (OAuth). */
  supports: (kind: AccountKind) => boolean;
  start: (account: AccountView) => void | Promise<void>;
};

/**
 * The kinds to offer when adding an account while searching: those whose label, platform or
 * defining extension match the query; all of them when none does.
 */
export function kindsToAdd(
  kinds: readonly AccountKind[],
  query: string,
  extensionName: (kind: string) => string | undefined,
): AccountKind[] {
  const terms = words(query);
  const matching = kinds.filter((kind) => {
    const text = [
      kind.label,
      kind.kind,
      kind.platform,
      extensionName(kind.kind),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  return terms.length > 0 && matching.length > 0 ? matching : [...kinds];
}

/** The platforms an extension's page links to: those its definitions are for and those it uses. */
export function platformsOfExtension(extension: {
  accountKinds: readonly Pick<AccountKind, "platform">[];
  uses?: readonly { platform: string }[] | undefined;
}): string[] {
  return [
    ...new Set([
      ...extension.accountKinds.flatMap((kind) =>
        kind.platform ? [kind.platform] : [],
      ),
      ...(extension.uses ?? []).map((use) => use.platform),
    ]),
  ];
}
