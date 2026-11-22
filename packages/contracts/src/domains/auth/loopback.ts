import { z } from "zod";

/** Says what {@link loopbackRedirectPathSchema} accepts, for error messages. */
export const LOOPBACK_REDIRECT_PATH_RULE =
  "a URL path such as `/oauth/callback`: segments of letters, digits and `._~-` between single slashes, no `.` or `..` segments, no query or fragment, at most 200 characters";

/**
 * The path of a loopback redirect URI. Only characters a browser sends unchanged are allowed, so
 * the path of the redirect it requests equals this exactly.
 */
export const loopbackRedirectPathSchema = z
  .string()
  .max(200, `Must be ${LOOPBACK_REDIRECT_PATH_RULE}.`)
  .regex(
    /^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*$/,
    `Must be ${LOOPBACK_REDIRECT_PATH_RULE}.`,
  )
  .refine(
    (path) => !path.split("/").some((segment) => /^\.{1,2}$/.test(segment)),
    `Must be ${LOOPBACK_REDIRECT_PATH_RULE}.`,
  );
