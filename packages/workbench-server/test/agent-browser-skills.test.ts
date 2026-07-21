import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  AgentBrowserSkillCatalog,
  type AgentBrowserCommandRunner,
} from "../src/domains/agents/prompting/agent-browser-skills.js";

class FakeRunner implements AgentBrowserCommandRunner {
  constructor(private readonly response: (args: readonly string[]) => string) {}

  async run(args: readonly string[]): Promise<string> {
    return this.response(args);
  }
}

function catalogJson(
  skills: Array<{ name: string; description: string }>,
): string {
  return JSON.stringify({ data: skills });
}

function skillContent(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

describe("Agent Browser skill catalog", () => {
  it("treats a missing executable as an unavailable optional capability", async () => {
    const missingExecutable = Object.assign(new Error("not found"), {
      code: "ENOENT",
    });
    const catalog = new AgentBrowserSkillCatalog({
      run: async () => Promise.reject(missingExecutable),
    });

    await catalog.initialize();

    assert.deepEqual(catalog.skills, []);
    assert.equal(catalog.tempRoot, undefined);
    await catalog.shutdown();
  });

  it("stages and loads full skill definitions until shutdown", async () => {
    const catalog = new AgentBrowserSkillCatalog(
      new FakeRunner((args) => {
        if (args.join(" ") === "skills --json") {
          return catalogJson([
            { name: "core", description: "Core browser guidance" },
            { name: "dogfood", description: "Explore a web application" },
          ]);
        }
        const name = args[2];
        if (name === "core") {
          return skillContent(
            "core",
            "Core browser guidance",
            "Use snapshots and refs.",
          );
        }
        return skillContent(
          "dogfood",
          "Explore a web application",
          "Collect reproduction evidence.",
        );
      }),
    );

    await catalog.initialize();

    assert.deepEqual(
      catalog.skills.map(({ name }) => name),
      ["core", "dogfood"],
    );
    assert.equal(catalog.skills[0]?.content, "Use snapshots and refs.");
    assert.deepEqual(
      catalog.availableSkills.map(({ name, description }) => ({
        name,
        description,
      })),
      [
        { name: "core", description: "Core browser guidance" },
        { name: "dogfood", description: "Explore a web application" },
      ],
    );
    const tempRoot = catalog.tempRoot;
    assert.ok(tempRoot);
    assert.match(
      await readFile(join(tempRoot, "core", "SKILL.md"), "utf8"),
      /Use snapshots and refs/,
    );

    await catalog.shutdown();
    await catalog.shutdown();
    assert.equal(catalog.tempRoot, undefined);
    await assert.rejects(access(tempRoot));
  });

  it("rejects unsafe names before creating a temporary tree", async () => {
    const catalog = new AgentBrowserSkillCatalog(
      new FakeRunner(() =>
        catalogJson([
          { name: "../escape", description: "Unsafe browser guidance" },
        ]),
      ),
    );

    await assert.rejects(
      catalog.initialize(),
      /Invalid Agent Browser skill name/,
    );
    assert.equal(catalog.tempRoot, undefined);
    assert.deepEqual(catalog.skills, []);
  });

  it("fails closed and cleans staged files when a full skill is invalid", async () => {
    const catalog = new AgentBrowserSkillCatalog(
      new FakeRunner((args) => {
        if (args.join(" ") === "skills --json") {
          return catalogJson([
            { name: "core", description: "Core browser guidance" },
          ]);
        }
        return "This definition has no required description frontmatter.";
      }),
    );

    await assert.rejects(catalog.initialize(), /Could not load staged/);
    assert.equal(catalog.tempRoot, undefined);
    assert.deepEqual(catalog.skills, []);
  });
});
