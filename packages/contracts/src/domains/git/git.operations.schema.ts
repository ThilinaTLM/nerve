import {
  createBranchRequestSchema,
  gitBranchListResponseSchema,
  gitDiscoveryResponseSchema,
  gitFileActionRequestSchema,
  gitMutationResponseSchema,
  gitOverviewResponseSchema,
  gitRemoteOpRequestSchema,
  githubPrCheckoutResponseSchema,
  githubPrDetailSchema,
  githubPrListRequestSchema,
  githubPrListResponseSchema,
  githubStatusResponseSchema,
  switchBranchRequestSchema,
} from "./index.js";
import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";

const projectIdSchema = z.string().startsWith("proj_");
const projectIdParamsSchema = z.object({ projectId: projectIdSchema });
const gitRepoParamsSchema = projectIdParamsSchema.extend({
  repo: z.string().min(1).default("."),
});
const gitCreateBranchParamsSchema = projectIdParamsSchema.merge(
  createBranchRequestSchema,
);
const gitSwitchBranchParamsSchema = projectIdParamsSchema.merge(
  switchBranchRequestSchema,
);
const gitFileActionParamsSchema = projectIdParamsSchema.merge(
  gitFileActionRequestSchema,
);
const gitRemoteOpParamsSchema = projectIdParamsSchema.merge(
  gitRemoteOpRequestSchema,
);
const githubPrListParamsSchema = projectIdParamsSchema.merge(
  githubPrListRequestSchema,
);
const githubPrParamsSchema = gitRepoParamsSchema.extend({
  number: z.number().int().positive(),
});

export const gitOperationDefinitions = [
  defineOperation(
    "git.repos.discover",
    projectIdParamsSchema,
    gitDiscoveryResponseSchema,
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.git.repos.discover",
  ),
  defineOperation(
    "git.overview.get",
    gitRepoParamsSchema,
    gitOverviewResponseSchema,
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.git.overview.get",
  ),
  defineOperation(
    "git.branches.list",
    gitRepoParamsSchema,
    gitBranchListResponseSchema,
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.git.branches.list",
  ),
  defineOperation(
    "git.branch.create",
    gitCreateBranchParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.git.branch.create",
  ),
  defineOperation(
    "git.branch.switch",
    gitSwitchBranchParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.git.branch.switch",
  ),
  defineOperation(
    "git.file.stage",
    gitFileActionParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.git.file.stage",
  ),
  defineOperation(
    "git.file.unstage",
    gitFileActionParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.git.file.unstage",
  ),
  defineOperation(
    "git.file.discard",
    gitFileActionParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.git.file.discard",
  ),
  defineOperation(
    "git.sync",
    gitRemoteOpParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.git.sync",
  ),
  defineOperation(
    "git.push",
    gitRemoteOpParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.git.push",
  ),
  defineOperation(
    "git.pull",
    gitRemoteOpParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.git.pull",
  ),
  defineOperation(
    "git.fetch",
    gitRemoteOpParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.git.fetch",
  ),
  defineOperation(
    "git.switchBaseAndPull",
    gitRemoteOpParamsSchema,
    gitMutationResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.git.switchBaseAndPull",
  ),
  defineOperation(
    "github.status.get",
    gitRepoParamsSchema,
    githubStatusResponseSchema,
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.github.status.get",
  ),
  defineOperation(
    "github.pr.list",
    githubPrListParamsSchema,
    githubPrListResponseSchema,
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.github.pr.list",
  ),
  defineOperation(
    "github.pr.get",
    githubPrParamsSchema,
    githubPrDetailSchema,
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.github.pr.get",
  ),
  defineOperation(
    "github.pr.checkout",
    githubPrParamsSchema,
    githubPrCheckoutResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.github.pr.checkout",
  ),
] as const;
