import { join } from "node:path";
import { access } from "node:fs/promises";
import type { ConfigurationResource } from "@nervekit/contracts/configuration";
import type { LaunchDefinitionService } from "../../../domains/launch-definitions/launch-definition.service.js";
import type {
  ConfigurationResourceProvider,
  ResourceContext,
} from "../resource-registry.js";

/** The project's launch catalog. It is read fresh on every use, so reload equals check. */
export function launchProvider(options: {
  launchDefinitions: Pick<LaunchDefinitionService, "problem">;
}): ConfigurationResourceProvider {
  async function problem(
    context: ResourceContext,
  ): Promise<ConfigurationResource[]> {
    if (context.scope !== "project") return [];
    const found = await options.launchDefinitions.problem(context.projectId);
    if (!found) return [];
    return [
      {
        kind: "launch-catalog",
        id: "definitions.json",
        scope: "project",
        path: found.path,
        state: "invalid",
        diagnostics: [
          {
            level: "error",
            code: "invalid-value",
            message: `Invalid (${found.reason}). Until it is fixed, the project has no launch definitions.`,
          },
        ],
      },
    ];
  }
  return {
    kinds: ["launch-catalog"],
    async list(context) {
      const broken = await problem(context);
      if (broken.length > 0 || context.scope !== "project") return broken;
      const path = join(
        context.projectDirectory ?? "",
        ".nerve",
        "launches",
        "definitions.json",
      );
      return (await access(path).then(
        () => true,
        () => false,
      ))
        ? [
            {
              kind: "launch-catalog",
              id: "definitions.json",
              scope: "project",
              path,
              state: "active",
              diagnostics: [],
            },
          ]
        : [];
    },
    check: problem,
    reload: problem,
  };
}
