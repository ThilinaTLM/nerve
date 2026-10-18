/** CLI commands retain user hooks/helpers/signing/filters; these bounds govern lifetime,
 * never replace the user's environment or Git configuration. Queue wait is not elapsed
 * execution time. Multi-step workflows share one deadline once their lane starts.
 */
export const GIT_NETWORK_INACTIVITY_MS = 120_000;
export const GIT_NETWORK_DEADLINE_MS = 30 * 60_000;
export const GIT_TERMINATION_GRACE_MS = 3_000;
