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
 * them: the rows, the filters over them, and the level moves each account allows.
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

/**
 * One filter per facet; add a facet (platform) by extending this union and `facets`.
 * An empty value shows everything.
 */
export type AccountFacet = "extension" | "kind" | "level" | "state";
export type AccountFilters = Record<AccountFacet, string>;

export const noAccountFilters: AccountFilters = {
  extension: "",
  kind: "",
  level: "",
  state: "",
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

type Facet = {
  label: string;
  /** The row's value for this facet; undefined when it has none. */
  value: (row: AccountRowModel) => string | undefined;
  /** Every value the filter offers, with its label. */
  options: (
    rows: readonly AccountRowModel[],
    kinds: readonly AccountKind[],
  ) => { value: string; label: string }[];
};

const facets: Record<AccountFacet, Facet> = {
  extension: {
    label: "Extension",
    value: (row) => row.extension?.id,
    options: (rows) =>
      [
        ...new Map(
          rows.flatMap((row) =>
            row.extension
              ? [[row.extension.id, row.extension.name] as const]
              : [],
          ),
        ),
      ].map(([value, label]) => ({ value, label })),
  },
  kind: {
    label: "Kind",
    value: (row) => row.account.kind,
    options: (rows, kinds) => {
      const labels = new Map(kinds.map((kind) => [kind.kind, kind.label]));
      for (const row of rows)
        labels.set(row.account.kind, row.kind?.label ?? row.account.kind);
      return [...labels].map(([value, label]) => ({ value, label }));
    },
  },
  level: {
    label: "Level",
    value: (row) => row.account.level,
    options: () =>
      Object.entries(levelLabels).map(([value, label]) => ({ value, label })),
  },
  state: {
    label: "State",
    value: (row) => row.account.state,
    options: () =>
      Object.entries(stateLabels).map(([value, label]) => ({ value, label })),
  },
};

export const accountFacets = Object.keys(facets) as AccountFacet[];
export const facetLabel = (facet: AccountFacet): string => facets[facet].label;

export function facetOptions(
  facet: AccountFacet,
  rows: readonly AccountRowModel[],
  kinds: readonly AccountKind[],
): { value: string; label: string }[] {
  return facets[facet].options(rows, kinds);
}

export function filterAccountRows(
  rows: readonly AccountRowModel[],
  filters: AccountFilters,
): AccountRowModel[] {
  return rows.filter((row) =>
    accountFacets.every(
      (facet) => !filters[facet] || facets[facet].value(row) === filters[facet],
    ),
  );
}

export const hasAccountFilters = (filters: AccountFilters): boolean =>
  accountFacets.some((facet) => filters[facet] !== "");

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
      return "Needs credentials";
    case "failed":
      return account.error ?? "The credential does not work";
    case "unavailable":
      return "Its extension is off or gone";
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
