import { checkAtlassianConnection } from "@nervekit/extensions";
import { ApplicationError } from "../../core/application-error.js";
import type {
  AccountTester,
  AccountTestResult,
} from "./integration-health.service.js";

const services = [
  { id: "jira", label: "Jira" },
  { id: "confluence", label: "Confluence" },
] as const;

const field = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * Jira and Confluence are checked together: rejected credentials win, then
 * unreachable; otherwise the account is verified when any service answers,
 * and the message names what is not available.
 */
export function testAtlassianAccount(
  check: typeof checkAtlassianConnection = checkAtlassianConnection,
): AccountTester {
  return async (account, token) => {
    const siteUrl = field(account.fields.siteUrl);
    const email = field(account.fields.email);
    if (!siteUrl || !email)
      throw new ApplicationError(
        400,
        "ACCOUNT_INCOMPLETE",
        "Add the site URL and email before testing this account.",
      );
    const results = await Promise.all(
      services.map(async (service) => ({
        label: service.label,
        outcome: await check({ siteUrl, email, token }, service.id),
      })),
    );
    const problems = results.filter(
      ({ outcome }) => outcome.status !== "verified",
    );
    const message = problems
      .map(
        ({ label, outcome }) =>
          `${label}: ${outcome.message ?? outcome.status}`,
      )
      .join("\n");
    const has = (status: AccountTestResult["status"]) =>
      results.some(({ outcome }) => outcome.status === status);
    const status = has("rejected")
      ? "rejected"
      : has("unreachable")
        ? "unreachable"
        : has("verified")
          ? "verified"
          : (results[0]?.outcome.status ?? "unreachable");
    return { status, ...(message ? { message } : {}) };
  };
}

/** Connection checks by account kind; a kind's manifest `test` hook replaces its entry. */
export const accountTesters: Readonly<Record<string, AccountTester>> = {
  atlassian: testAtlassianAccount(),
};
