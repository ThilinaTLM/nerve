import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AgentBrowserSkillCatalog,
  type AgentBrowserCommandRunner,
} from "./agent-browser-skills.js";

const descriptions: Record<string, string> = {
  core: "Core browser automation guide.",
  dogfood: "Explore and test a web application.",
  agentcore: "Run on AWS Bedrock AgentCore cloud browsers.",
  slack: "Interact with Slack workspaces.",
  "vercel-sandbox": "Run inside Vercel Sandbox microVMs.",
  "protected-vercel-deployments": "Access protected Vercel deployments.",
};

const runner: AgentBrowserCommandRunner = {
  async run(args) {
    if (args.length === 2) {
      return JSON.stringify({
        data: Object.entries(descriptions).map(([name, description]) => ({
          name,
          description,
        })),
      });
    }
    const name = args[2];
    return `---\nname: ${name}\ndescription: ${descriptions[name]}\n---\n\n# ${name}\n`;
  },
};

void describe("AgentBrowserSkillCatalog", () => {
  void it("hides skills tied to a specific hosted environment", async () => {
    const catalog = new AgentBrowserSkillCatalog(runner);
    try {
      await catalog.initialize();
      assert.deepEqual(
        catalog.availableSkills.map((skill) => skill.name),
        ["core", "dogfood"],
      );
    } finally {
      await catalog.shutdown();
    }
  });
});
