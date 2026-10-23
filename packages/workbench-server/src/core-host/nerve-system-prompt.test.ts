import assert from "node:assert/strict";
import test from "node:test";
import { buildNerveSystemPrompt } from "./nerve-system-prompt.js";

void test("prompt contains no mode controls or built-in planning instructions", () => {
  const prompt = buildNerveSystemPrompt({
    cwd: "/w",
    selectedTools: ["read", "plan_present"],
  });
  assert.doesNotMatch(
    prompt,
    /<mode_controls>|<plan_mode|plan_dir|Conversation mode/,
  );
});

void test("custom prompt replaces only the base", () => {
  const prompt = buildNerveSystemPrompt({
    cwd: "/w",
    customPrompt: "Custom persona",
    instructions: "Profile instructions",
  });
  assert.ok(prompt.startsWith("Custom persona\n\n"));
  assert.match(prompt, /<instructions>\nProfile instructions/);
  assert.doesNotMatch(prompt, /You are Nerve/);
});

void test("default guidelines contain only the agreed lines and conditionally ask_user", () => {
  for (const selectedTools of [["read"], ["read", "ask_user"]]) {
    const prompt = buildNerveSystemPrompt({ cwd: "/w", selectedTools });
    assert.ok(
      prompt.startsWith(
        "You are Nerve's coding agent, working in the user's project. Keep responses concise.\n\n",
      ),
    );
    const guidelines = prompt.match(
      /<guidelines>\n([\s\S]*?)\n<\/guidelines>/,
    )?.[1];
    assert.equal(
      guidelines,
      [
        "- Continue until the task is complete or blocked by a user decision.",
        "- Responses render as Markdown with Mermaid; use diagrams for complex relationships or flows, otherwise prose.",
        ...(selectedTools.includes("ask_user")
          ? ["- Ask the user questions with `ask_user`, not in your reply."]
          : []),
      ].join("\n"),
    );
    assert.doesNotMatch(
      prompt,
      /<tool_rules>|<working_rules>|<agent_instructions>/,
    );
  }
});

void test("custom base preserves all appended sections in order", () => {
  const prompt = buildNerveSystemPrompt({
    cwd: "/w",
    customPrompt: "Custom base",
    appendSystemPrompt: "Append content",
    instructions: "Profile instructions",
    contextFiles: [{ path: "AGENTS.md", content: "Project instructions" }],
    skills: [{ name: "s", description: "d", filePath: "/s/SKILL.md" } as never],
    agentProfiles: [
      { name: "explore", description: "Research", permission: "Read only" },
    ],
    selectedTools: ["read", "subagent_prompt", "ask_user"],
  });
  assert.doesNotMatch(prompt, /<guidelines>|You are Nerve/);
  const sections = [
    "Custom base",
    "Append content",
    "<instructions>",
    "<project_instructions ",
    "<available_skills>",
    "<available_agent_profiles>",
    "<environment>",
  ];
  for (let i = 1; i < sections.length; i++) {
    assert.ok(
      prompt.indexOf(sections[i - 1]) < prompt.indexOf(sections[i]),
      sections[i],
    );
  }
});

void test("profile listing requires creation tool and usable profiles", () => {
  for (const selectedTools of [[], ["subagent_status"]]) {
    assert.doesNotMatch(
      buildNerveSystemPrompt({
        cwd: "/w",
        selectedTools,
        agentProfiles: [
          { name: "explore", description: "Research", permission: "Read only" },
        ],
      }),
      /<available_agent_profiles>/,
    );
  }
  assert.doesNotMatch(
    buildNerveSystemPrompt({
      cwd: "/w",
      selectedTools: ["subagent_prompt"],
      agentProfiles: [],
    }),
    /<available_agent_profiles>/,
  );
});

void test("conversation custom base never drops separately captured profile/local instructions", () => {
  const options = {
    cwd: "/project",
    systemPrompt: "Exact custom base",
    instructions: "Profile instructions\n\nConversation instructions",
  };
  assert.equal(
    buildNerveSystemPrompt(options),
    "Exact custom base\n\nProfile instructions\n\nConversation instructions",
  );
  assert.equal(
    buildNerveSystemPrompt({
      ...options,
      systemPrompt: "Next turn base",
      instructions: "Next turn context",
    }),
    "Next turn base\n\nNext turn context",
  );
  assert.equal(
    buildNerveSystemPrompt({ cwd: "/project", systemPrompt: "" }),
    "",
  );
});
