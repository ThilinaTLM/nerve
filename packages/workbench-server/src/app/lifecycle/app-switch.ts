/** A fetch handler whose target can be replaced while the listener stays bound. */
export interface AppSwitch {
  fetch(request: Request, env?: unknown): Response | Promise<Response>;
  set(app: { fetch: AppSwitch["fetch"] }): void;
}

export function createAppSwitch(initial: {
  fetch: AppSwitch["fetch"];
}): AppSwitch {
  let current = initial;
  return {
    fetch: (request, env) => current.fetch(request, env),
    set: (app) => {
      current = app;
    },
  };
}
