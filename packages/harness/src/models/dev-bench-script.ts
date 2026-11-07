/**
 * Deterministic turn script for the dev-only "Scripted Bench" model. It mimics
 * a real coding run (thinking + text + one tool call per turn, ~16 calls) so
 * UI streaming benchmarks are repeatable without a real model. Pure data: the
 * provider in `dev-bench-provider.ts` streams it.
 */

export interface DevBenchToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface DevBenchTurn {
  thinking: string;
  text: string;
  tool?: DevBenchToolCall;
}

export const DEV_BENCH_DEFAULT_DIR = "qa-sandbox-bench-scripted";

const FILLER = [
  "Let me think about how the pieces fit together before changing anything.",
  "The storage format should stay trivial so the tests remain easy to reason about.",
  "Keeping each step small makes the progress easy to follow and easy to verify.",
  "I will prefer the standard library only, so there is nothing to install.",
  "Each command needs a clear exit status and a readable error message.",
  "It is worth double checking edge cases such as an empty list or a missing id.",
];

/** Grows `base` with fixed filler sentences to at least `length` characters. */
function pad(base: string, length: number, seed: number): string {
  let text = base;
  for (let index = seed; text.length < length; index += 1) {
    text += ` ${FILLER[index % FILLER.length]}`;
  }
  return text;
}

const TODO_PY = `"""Tiny JSON-backed todo list."""
import argparse
import json
import os
import sys

DEFAULT_PATH = "todos.json"


def load(path=DEFAULT_PATH):
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def save(items, path=DEFAULT_PATH):
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(items, handle, indent=2)


def add(items, title):
    next_id = max((item["id"] for item in items), default=0) + 1
    items.append({"id": next_id, "title": title, "done": False})
    return items[-1]


def mark_done(items, item_id):
    for item in items:
        if item["id"] == item_id:
            item["done"] = True
            return item
    raise KeyError(item_id)


def remove(items, item_id):
    for index, item in enumerate(items):
        if item["id"] == item_id:
            return items.pop(index)
    raise KeyError(item_id)


def render(items):
    return "\\n".join(
        "[{}] {} {}".format("x" if item["done"] else " ", item["id"], item["title"])
        for item in items
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="Manage a todo list")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list")
    sub.add_parser("add").add_argument("title")
    sub.add_parser("done").add_argument("id", type=int)
    sub.add_parser("remove").add_argument("id", type=int)
    args = parser.parse_args(argv)
    items = load()
    try:
        if args.command == "add":
            add(items, args.title)
        elif args.command == "done":
            mark_done(items, args.id)
        elif args.command == "remove":
            remove(items, args.id)
        else:
            print(render(items))
            return 0
    except KeyError:
        print("no such todo", file=sys.stderr)
        return 1
    save(items)
    return 0


if __name__ == "__main__":
    sys.exit(main())
`;

const TEST_PY = `import unittest

import todo


class TodoTests(unittest.TestCase):
    def test_add_assigns_incrementing_ids(self):
        items = []
        first = todo.add(items, "write code")
        second = todo.add(items, "write tests")
        self.assertEqual((first["id"], second["id"]), (1, 2))

    def test_done_marks_item(self):
        items = []
        todo.add(items, "ship it")
        self.assertTrue(todo.mark_done(items, 1)["done"])

    def test_remove_missing_raises(self):
        with self.assertRaises(KeyError):
            todo.remove([], 7)

    def test_render_shows_state(self):
        items = []
        todo.add(items, "a")
        todo.mark_done(items, 1)
        self.assertEqual(todo.render(items), "[x] 1 a")


if __name__ == "__main__":
    unittest.main()
`;

const README = `# Todo CLI

A tiny JSON-backed todo list.

    python3 todo.py add "buy milk"
    python3 todo.py list
    python3 todo.py done 1
    python3 todo.py remove 1

Run the tests with \`python3 -m unittest\`.
`;

const STEP_TITLES = [
  "Set up the project folder",
  "Write todo.py",
  "Write README and tests",
  "Run the tests",
  "Review the code",
] as const;

function todos(done: number) {
  return {
    todos: STEP_TITLES.map((todo, index) => ({ todo, done: index < done })),
  };
}

/** The ordered turns for a run whose scratch folder is `dir`. */
export function buildDevBenchScript(dir: string): DevBenchTurn[] {
  const turn = (
    thinking: string,
    text: string,
    tool: DevBenchToolCall | undefined,
    index: number,
  ): DevBenchTurn => ({ thinking: pad(thinking, 800, index), text, tool });
  const streamCommand =
    'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo "check $i: ok"; sleep 0.4; done';
  const turns: [string, string, DevBenchToolCall?][] = [
    [
      "The task is a small Python todo CLI in a scratch folder.",
      "I'll start by laying out a plan.",
      { name: "todos_set", args: todos(0) },
    ],
    [
      "First I need the folder itself.",
      `Creating ${dir}.`,
      { name: "bash", args: { command: `mkdir -p ${dir}` } },
    ],
    [
      "The main module comes first, with load, save and the four commands.",
      "Writing todo.py with add, list, done and remove.",
      { name: "write", args: { path: `${dir}/todo.py`, content: TODO_PY } },
    ],
    [
      "Documentation is short; it only needs the usage lines.",
      "Adding a README.",
      { name: "write", args: { path: `${dir}/README.md`, content: README } },
    ],
    [
      "The tests should exercise the pure helpers, not the filesystem.",
      "Adding unit tests.",
      {
        name: "write",
        args: { path: `${dir}/test_todo.py`, content: TEST_PY },
      },
    ],
    [
      "Files are in place; the plan can move forward.",
      "Updating the todo list.",
      { name: "todos_set", args: todos(3) },
    ],
    [
      "Run the suite once to see where things stand.",
      "Running the tests.",
      {
        name: "bash",
        args: { command: "python3 -m unittest -v", cwd: dir },
      },
    ],
    [
      "A short command with streaming output exercises live tool output.",
      "Running a few sanity checks that print as they go.",
      { name: "bash", args: { command: streamCommand, cwd: dir } },
    ],
    [
      "The data file location should be configurable for scripting.",
      "Making the storage path configurable through TODO_FILE.",
      {
        name: "edit",
        args: {
          path: `${dir}/todo.py`,
          edits: [
            {
              oldText: 'DEFAULT_PATH = "todos.json"',
              newText:
                'DEFAULT_PATH = os.environ.get("TODO_FILE", "todos.json")',
            },
          ],
        },
      },
    ],
    [
      "Re-run the tests after the edit.",
      "Re-running the tests.",
      { name: "bash", args: { command: "python3 -m unittest", cwd: dir } },
    ],
    [
      "Now review: first find where each command is handled.",
      "Searching for the command handlers.",
      { name: "grep", args: { pattern: "def ", path: dir } },
    ],
    [
      "Read the module once more in full.",
      "Reading todo.py.",
      { name: "read", args: { path: `${dir}/todo.py` } },
    ],
    [
      "And the tests.",
      "Reading test_todo.py.",
      { name: "read", args: { path: `${dir}/test_todo.py` } },
    ],
    [
      "Everything checks out; update the plan.",
      "Updating the todo list.",
      { name: "todos_set", args: todos(4) },
    ],
    [
      "A last look at what the folder contains.",
      "Listing the final files.",
      { name: "bash", args: { command: "ls -la", cwd: dir } },
    ],
    [
      "All steps are done.",
      "Marking everything complete.",
      { name: "todos_set", args: todos(5) },
    ],
  ];
  const script = turns.map(([thinking, text, tool], index) =>
    turn(thinking, text, tool, index),
  );
  script.push({
    thinking: pad("Time to summarize the work.", 500, 3),
    text: `The todo CLI is ready in ${dir}.\n\n- todo.py: add, list, done and remove commands backed by a JSON file (path configurable with TODO_FILE).\n- README.md: usage examples.\n- test_todo.py: four unit tests that pass under python3 -m unittest.\n\nI reviewed the code with grep and read, and every step of the plan is complete.`,
  });
  return script;
}

export const DEV_BENCH_PROVIDER = "nerve-dev-scripted";
export const DEV_BENCH_MODEL = "scripted-bench";
export const DEV_BENCH_MODEL_NAME = "Scripted Bench";

/** Streaming shape: 16 tokens/delta (64 chars) every ~30 ms. */
export const DEV_BENCH_TOKEN_SIZE = 16;
export const DEV_BENCH_TOKENS_PER_SECOND = 533;
/** Simulated time-to-first-token before each turn. */
export const DEV_BENCH_FIRST_TOKEN_MS = 900;
