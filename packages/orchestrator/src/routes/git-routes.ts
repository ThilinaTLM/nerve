import type { AgentModelSelection } from "@nerve/agent";
import {
  commitRequestSchema,
  createBranchRequestSchema,
  createPrRequestSchema,
  gitRemoteOpRequestSchema,
  syncBaseRequestSchema,
} from "@nerve/shared";
import { Hono } from "hono";
import { HttpError } from "../http/errors.js";
import { routeHandler } from "../http/responses.js";
import type { OrchestratorState } from "../server.js";

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

function agentModel(
  state: OrchestratorState,
  agentId: string | undefined,
): AgentModelSelection | undefined {
  if (!agentId) return undefined;
  try {
    return state.registry.getAgent(agentId).model;
  } catch {
    return undefined;
  }
}

export function createGitRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get(
    "/projects/:projectId/git/repos",
    routeHandler(async (c) =>
      c.json(await state.registry.git.discoverRepos(c.req.param("projectId"))),
    ),
  );

  app.get(
    "/projects/:projectId/git/overview",
    routeHandler(async (c) =>
      c.json(
        await state.registry.git.overview(
          c.req.param("projectId"),
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
          c.req.param("projectId"),
          body.repo,
          body.name,
        ),
      );
    }),
  );

  app.post(
    "/projects/:projectId/git/commit",
    routeHandler(async (c) => {
      const body = commitRequestSchema.parse(await c.req.json());
      return c.json(
        await state.registry.git.commit(c.req.param("projectId"), body.repo, {
          subject: body.subject,
          body: body.body,
          all: body.all,
        }),
      );
    }),
  );

  app.post(
    "/projects/:projectId/git/sync-base",
    routeHandler(async (c) => {
      const body = syncBaseRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json(
        await state.registry.git.syncBase(c.req.param("projectId"), body.repo),
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
        await state.registry.git.push(c.req.param("projectId"), body.repo),
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
        await state.registry.git.pull(c.req.param("projectId"), body.repo),
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
        await state.registry.git.fetch(c.req.param("projectId"), body.repo),
      );
    }),
  );

  app.get(
    "/projects/:projectId/git/suggest/branch",
    routeHandler(async (c) => {
      const projectId = c.req.param("projectId");
      const repo = repoParam(c.req.query("repo"));
      const [overview, diff] = await Promise.all([
        state.registry.git.overview(projectId, repo),
        state.registry.git.diffContext(projectId, repo),
      ]);
      return c.json(
        await state.registry.utilityLlm.suggestBranchName({
          overview,
          diff,
          model: agentModel(state, c.req.query("agentId")),
        }),
      );
    }),
  );

  app.get(
    "/projects/:projectId/git/suggest/commit",
    routeHandler(async (c) => {
      const projectId = c.req.param("projectId");
      const repo = repoParam(c.req.query("repo"));
      const [overview, diff] = await Promise.all([
        state.registry.git.overview(projectId, repo),
        state.registry.git.diffContext(projectId, repo),
      ]);
      return c.json(
        await state.registry.utilityLlm.suggestCommitMessage({
          overview,
          diff,
          model: agentModel(state, c.req.query("agentId")),
        }),
      );
    }),
  );

  app.get(
    "/projects/:projectId/github/status",
    routeHandler(async (c) =>
      c.json(
        await state.registry.git.githubStatus(
          c.req.param("projectId"),
          repoParam(c.req.query("repo")),
        ),
      ),
    ),
  );

  app.get(
    "/projects/:projectId/github/prs",
    routeHandler(async (c) =>
      c.json(
        await state.registry.git.listMyPrs(
          c.req.param("projectId"),
          repoParam(c.req.query("repo")),
        ),
      ),
    ),
  );

  app.post(
    "/projects/:projectId/github/pr",
    routeHandler(async (c) => {
      const body = createPrRequestSchema.parse(await c.req.json());
      return c.json(
        await state.registry.git.createPr(c.req.param("projectId"), body.repo, {
          title: body.title,
          body: body.body,
          base: body.base,
          draft: body.draft,
        }),
      );
    }),
  );

  app.get(
    "/projects/:projectId/github/pr/:number",
    routeHandler(async (c) =>
      c.json(
        await state.registry.git.prDetail(
          c.req.param("projectId"),
          repoParam(c.req.query("repo")),
          prNumberParam(c.req.param("number")),
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
          c.req.param("projectId"),
          body.repo,
          prNumberParam(c.req.param("number")),
        ),
      );
    }),
  );

  return app;
}
