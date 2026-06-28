import {
  createBranchRequestSchema,
  gitFileActionRequestSchema,
  gitRemoteOpRequestSchema,
  switchBranchRequestSchema,
} from "@nervekit/shared";
import { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { HttpError } from "../http/errors.js";
import { routeHandler } from "../http/responses.js";
import { routeParam } from "../http/route-params.js";

function prNumberParam(value: string | undefined): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new HttpError(
      400,
      "GH_INVALID_PR_NUMBER",
      "Invalid pull request number.",
    );
  }
  return number;
}

function repoParam(value: string | undefined): string {
  return value && value.length > 0 ? value : ".";
}

export function createGitRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get(
    "/projects/:projectId/git/repos",
    routeHandler(async (c) =>
      c.json(
        await state.registry.git.discoverRepos(routeParam(c, "projectId")),
      ),
    ),
  );

  app.get(
    "/projects/:projectId/git/overview",
    routeHandler(async (c) =>
      c.json(
        await state.registry.git.overview(
          routeParam(c, "projectId"),
          repoParam(c.req.query("repo")),
        ),
      ),
    ),
  );

  app.get(
    "/projects/:projectId/git/branches",
    routeHandler(async (c) =>
      c.json(
        await state.registry.git.listBranches(
          routeParam(c, "projectId"),
          repoParam(c.req.query("repo")),
        ),
      ),
    ),
  );

  app.post(
    "/projects/:projectId/git/branch",
    routeHandler(async (c) => {
      const body = createBranchRequestSchema.parse(await c.req.json());
      return c.json(
        await state.registry.git.createBranch(
          routeParam(c, "projectId"),
          body.repo,
          body.name,
        ),
      );
    }),
  );

  app.post(
    "/projects/:projectId/git/switch-branch",
    routeHandler(async (c) => {
      const body = switchBranchRequestSchema.parse(await c.req.json());
      return c.json(
        await state.registry.git.switchBranch(
          routeParam(c, "projectId"),
          body.repo,
          body.name,
        ),
      );
    }),
  );

  app.post(
    "/projects/:projectId/git/stage-file",
    routeHandler(async (c) => {
      const body = gitFileActionRequestSchema.parse(await c.req.json());
      return c.json(
        await state.registry.git.stageFile(
          routeParam(c, "projectId"),
          body.repo,
          body.path,
        ),
      );
    }),
  );

  app.post(
    "/projects/:projectId/git/unstage-file",
    routeHandler(async (c) => {
      const body = gitFileActionRequestSchema.parse(await c.req.json());
      return c.json(
        await state.registry.git.unstageFile(
          routeParam(c, "projectId"),
          body.repo,
          body.path,
        ),
      );
    }),
  );

  app.post(
    "/projects/:projectId/git/discard-file",
    routeHandler(async (c) => {
      const body = gitFileActionRequestSchema.parse(await c.req.json());
      return c.json(
        await state.registry.git.discardFile(
          routeParam(c, "projectId"),
          body.repo,
          body.path,
        ),
      );
    }),
  );

  app.post(
    "/projects/:projectId/git/sync",
    routeHandler(async (c) => {
      const body = gitRemoteOpRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json(
        await state.registry.git.syncBranch(
          routeParam(c, "projectId"),
          body.repo,
        ),
      );
    }),
  );

  app.post(
    "/projects/:projectId/git/push",
    routeHandler(async (c) => {
      const body = gitRemoteOpRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json(
        await state.registry.git.push(routeParam(c, "projectId"), body.repo),
      );
    }),
  );

  app.post(
    "/projects/:projectId/git/pull",
    routeHandler(async (c) => {
      const body = gitRemoteOpRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json(
        await state.registry.git.pull(routeParam(c, "projectId"), body.repo),
      );
    }),
  );

  app.post(
    "/projects/:projectId/git/fetch",
    routeHandler(async (c) => {
      const body = gitRemoteOpRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json(
        await state.registry.git.fetch(routeParam(c, "projectId"), body.repo),
      );
    }),
  );

  app.post(
    "/projects/:projectId/git/switch-base-and-pull",
    routeHandler(async (c) => {
      const body = gitRemoteOpRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json(
        await state.registry.git.switchBaseAndPull(
          routeParam(c, "projectId"),
          body.repo,
        ),
      );
    }),
  );

  app.get(
    "/projects/:projectId/github/status",
    routeHandler(async (c) =>
      c.json(
        await state.registry.git.githubStatus(
          routeParam(c, "projectId"),
          repoParam(c.req.query("repo")),
        ),
      ),
    ),
  );

  app.get(
    "/projects/:projectId/github/prs",
    routeHandler(async (c) =>
      c.json(
        await state.registry.git.listOpenPrs(
          routeParam(c, "projectId"),
          repoParam(c.req.query("repo")),
        ),
      ),
    ),
  );

  app.get(
    "/projects/:projectId/github/pr/:number",
    routeHandler(async (c) =>
      c.json(
        await state.registry.git.prDetail(
          routeParam(c, "projectId"),
          repoParam(c.req.query("repo")),
          prNumberParam(routeParam(c, "number")),
        ),
      ),
    ),
  );

  app.post(
    "/projects/:projectId/github/pr/:number/checkout",
    routeHandler(async (c) => {
      const body = gitRemoteOpRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json(
        await state.registry.git.checkoutPr(
          routeParam(c, "projectId"),
          body.repo,
          prNumberParam(routeParam(c, "number")),
        ),
      );
    }),
  );

  return app;
}
