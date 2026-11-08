import assert from "node:assert/strict";
import test from "node:test";
import {
  extractPromptReferences as prompts,
  extractCreatedReferences,
  parseGitRemote,
} from "./github.js";
const createdAll = (command: string, code: number, output: string) =>
  extractCreatedReferences({ kind: "shell", text: command }, code, output);
const created = (command: string, code: number, output: string) =>
  createdAll(command, code, output).at(-1) ?? null;
const python = (code: string, output: string) =>
  extractCreatedReferences({ kind: "python", text: code }, 0, output).map(
    (r) => `${r.kind}:${r.identifier}`,
  );
const remote = { host: "git.acme.test", owner: "Acme", repo: "API" };
test("canonical URLs normalize identity and resolve comments/reviews to the parent", () => {
  const refs = prompts(
    "Review https://github.com/Acme/API/pull/481/files?x=1#discussion_r2 and (https://github.com/Acme/API/issues/2#issuecomment-1).",
  );
  assert.deepEqual(
    refs.map((r) => [r.resourceKey, r.kind, r.url]),
    [
      [
        "github.com/acme/api#481",
        "pull_request",
        "https://github.com/Acme/API/pull/481",
      ],
      [
        "github.com/acme/api#2",
        "issue",
        "https://github.com/Acme/API/issues/2",
      ],
    ],
  );
  assert.equal(prompts("https://evil.test/a/b/pull/1").length, 0);
  assert.equal(
    prompts("https://git.acme.test/Acme/API/pull/2", [remote]).length,
    1,
  );
  assert.equal(prompts("http://github.com/a/b/issues/1")[0].url, null);
});
test("shorthand supports cues, unknown kind, and unambiguous bare numbers only", () => {
  assert.deepEqual(
    prompts("a/b#1 https://github.com/a/b/pull/2 a/b#3").map(
      (r) => r.identifier,
    ),
    ["1", "2", "3"],
  );
  assert.deepEqual(
    prompts("PR Acme/API#1 issue Acme/API#2 Acme/API#3").map((r) => r.kind),
    ["pull_request", "issue", "unknown"],
  );
  assert.equal(prompts("PR #1").length, 0);
  assert.equal(
    prompts("PR #1", [remote, { ...remote, repo: "other" }]).length,
    0,
  );
  assert.equal(
    prompts("PR #1", [remote])[0].resourceKey,
    "git.acme.test/acme/api#1",
  );
  assert.equal(prompts("#1", [remote]).length, 0);
  assert.equal(prompts("PR #1", [remote, remote]).length, 1);
});
test("fenced code is ignored including tilde and unclosed fences", () => {
  assert.equal(
    prompts(
      "```log\nhttps://github.com/a/b/pull/1\n```\n~~~\na/b#2\n~~~\na/b#3\n```\na/b#4",
    ).length,
    1,
  );
});
test("local git remotes parse HTTPS, SSH and scp forms", () => {
  for (const url of [
    "https://git.acme.test/Acme/API.git",
    "ssh://git@git.acme.test/Acme/API.git",
    "ssh://git@git.acme.test:2222/Acme/API.git",
    "git@git.acme.test:Acme/API.git",
  ])
    assert.deepEqual(parseGitRemote(url), remote);
});
test("creation requires an actual successful gh create command and matching URL, keeping all", () => {
  const output =
    "https://github.com/a/b/pull/1\nhttps://github.com/a/b/pull/2\nhttps://github.com/a/b/pull/1";
  assert.deepEqual(
    createdAll("gh pr create --title 'hello'", 0, output).map(
      (r) => r.identifier,
    ),
    ["1", "2"],
  );
  assert.equal(
    created("gh issue create", 0, "https://github.com/a/b/issues/3")
      ?.relationship,
    "created",
  );
  for (const [command, code, text] of [
    ["gh pr create", 1, output],
    ["gh pr view", 0, output],
    ["echo 'gh pr create'", 0, output],
    ["echo '; gh pr create'", 0, output],
    ["./create-pr.sh", 0, output],
    ["gh pr create", 0, "created!"],
    ["gh issue create", 0, output],
  ] as const)
    assert.equal(created(command, code, text), null);
});

test("shell create commands are found inside loops, conditionals, subshells and groups", () => {
  const output = "https://github.com/a/b/pull/7";
  for (const command of [
    "for r in a b; do (cd $r && gh pr create --fill); done",
    "if true; then gh pr create; fi",
    "{ gh pr create; }",
    "url=$(gh pr create --fill)",
    "true || gh pr create",
  ])
    assert.equal(created(command, 0, output)?.identifier, "7", command);
  assert.deepEqual(
    createdAll(
      "gh pr create && gh issue create",
      0,
      "https://github.com/a/b/pull/1\nhttps://github.com/a/b/issues/2",
    ).map((r) => r.kind),
    ["pull_request", "issue"],
  );
});

test("heredoc bodies and common wrappers do not hide shell create commands", () => {
  const output = "https://github.com/a/b/pull/7";
  const heredoc = "cat > /tmp/body.md <<'EOF'\nThe candidate's PR run.\nEOF\n";
  for (const command of [
    `${heredoc}timeout 60 gh pr create --body-file /tmp/body.md`,
    "cat <<-EOF > b\n\tit's\n\tEOF\ngh pr create",
    'GH_PROMPT_DISABLED=1 gh pr create --title "x"',
    "env -i FOO=1 gh pr create",
    "cat <<< 'x' && gh pr create",
  ])
    assert.equal(created(command, 0, output)?.identifier, "7", command);
  for (const command of [
    "cat <<EOF\ngh pr create\nEOF",
    "echo timeout 60 gh pr create",
  ])
    assert.equal(created(command, 0, output), null, command);
});

test("existing pull requests reported by gh are not recorded as created", () => {
  assert.deepEqual(
    createdAll(
      "gh pr create",
      0,
      'a pull request for branch "x" into branch "main" already exists:\nhttps://github.com/a/b/pull/5\nhttps://github.com/a/b/pull/6',
    ).map((r) => r.identifier),
    ["6"],
  );
});

test("python create detection accepts argv and command strings only", () => {
  const output = [1, 2, 3]
    .map((n) => `https://github.com/a/b/pull/${n}`)
    .join("\n");
  assert.deepEqual(
    python(
      'for r in repos:\n    subprocess.run(["gh", "pr", "create", "--title", t], cwd=r)',
      output,
    ),
    ["pull_request:1", "pull_request:2", "pull_request:3"],
  );
  assert.deepEqual(
    python(
      "os.system('gh issue create --title x')",
      "https://github.com/a/b/issues/4",
    ),
    ["issue:4"],
  );
  for (const code of [
    'subprocess.run(["gh", "pr", "view"])',
    'print("https://github.com/a/b/pull/1")',
  ])
    assert.deepEqual(python(code, output), []);
});

test("URL punctuation trimming handles long suffixes without dropping references", () => {
  const refs = prompts(`https://github.com/a/b/pull/7${"!".repeat(100_000)}`);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].url, "https://github.com/a/b/pull/7");
});

test("quoted and unterminated shell text cannot introduce create commands", () => {
  const output = "https://github.com/a/b/pull/7";
  for (const command of [
    `echo "${'\\"'.repeat(100_000)}; gh pr create`,
    "echo 'unterminated; gh pr create",
    String.raw`echo "escaped \"; gh pr create"`,
    `echo "first" 'second; gh pr create'`,
  ]) {
    assert.equal(created(command, 0, output), null);
  }
  assert.equal(
    created(
      String.raw`echo "quoted; gh issue create" && gh pr create --title "a \"quote\""`,
      0,
      output,
    )?.identifier,
    "7",
  );
});
