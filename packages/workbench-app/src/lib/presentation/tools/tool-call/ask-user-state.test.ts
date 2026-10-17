import assert from "node:assert/strict";
import test from "node:test";
import { toolArgumentSource } from "../lifecycle/argument-source";
import {
  askUserDraftQuestions,
  askUserQuestionPhase,
  askUserQuestionsFromArgs,
  askUserViewFromCall,
  createInMemoryAskUserDraftStore,
  projectAskUserAnswers,
} from "./ask-user-state";

test("in-memory draft hosts isolate calls and instances and merge question patches", () => {
  const store = createInMemoryAskUserDraftStore();
  store.update("a", "q", { option: "Yes" });
  store.update("a", "q", { text: "details" });
  store.update("b", "q", { text: "other call" });
  assert.deepEqual(store.get("a"), { q: { option: "Yes", text: "details" } });
  assert.deepEqual(createInMemoryAskUserDraftStore().get("a"), {});
  store.clear("a");
  assert.deepEqual(store.get("a"), {});
  assert.deepEqual(store.get("b"), { q: { text: "other call" } });
});

test("normalizes the new, id-less, and legacy flat argument shapes", () => {
  const current = askUserQuestionsFromArgs({
    questions: [
      {
        id: "db",
        question: "Which database?",
        options: [{ label: "SQLite", recommended: true }],
      },
    ],
  });
  assert.equal(current[0]?.id, "db");
  assert.equal(current[0]?.options[0]?.label, "SQLite");

  const idless = askUserQuestionsFromArgs({
    questions: [{ question: "A?" }, { question: "B?" }],
  });
  assert.deepEqual(
    idless.map((question) => question.id),
    ["q1", "q2"],
  );

  const legacy = askUserQuestionsFromArgs({
    question: "Old?",
    context: "ctx",
  });
  assert.equal(legacy[0]?.id, "answer");
  assert.equal(legacy[0]?.context, "ctx");
});

test("merges recorded results, skipped questions, and dismissal by id", () => {
  const args = { questions: [{ question: "A?" }, { question: "B?" }] };
  const view = askUserViewFromCall(args, {
    questions: [
      { id: "q1", question: "A?", answer: { option: "Yes", text: "why" } },
      { id: "q2", question: "B?", skipped: true },
    ],
  });
  assert.deepEqual(view.questions[0]?.answer, { option: "Yes", text: "why" });
  assert.equal(view.questions[1]?.skipped, true);
  assert.equal(view.dismissed, false);

  const dismissed = askUserViewFromCall(args, {
    questions: [{ id: "q1", question: "A?" }],
    dismissed: true,
  });
  assert.equal(dismissed.dismissed, true);
  assert.equal(dismissed.questions.length, 2);
});

test("renders a legacy flat result as one answered question", () => {
  const view = askUserViewFromCall(
    { question: "Which manager?" },
    { question: "Which manager?", response: "pnpm" },
  );
  assert.equal(view.questions.length, 1);
  assert.deepEqual(view.questions[0]?.answer, { text: "pnpm" });
  assert.equal(view.dismissed, false);
});

test("streamed arguments expose open questions and options as gaps", () => {
  const questions = askUserDraftQuestions(
    toolArgumentSource({
      argsText:
        '{"questions":[{"id":"a","question":"Pick one?","options":[{"label":"X"},{"label":"Y","descr',
    }),
  );
  assert.equal(questions.length, 1);
  assert.equal(questions[0]?.question, "Pick one?");
  assert.equal(questions[0]?.options[0]?.label, "X");
  assert.equal(questions[0]?.options[1]?.label, "Y");
  assert.equal(questions[0]?.context, undefined);
});

test("projects answers: trims, keeps options, omits empty questions", () => {
  const answers = projectAskUserAnswers(
    [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    {
      a: { option: "Yes", text: "  because  " },
      b: { text: "   " },
      c: { text: " free " },
      d: { option: "Only" },
      stray: { text: "ignored" },
    },
  );
  assert.deepEqual(answers, {
    a: { option: "Yes", text: "because" },
    c: { text: "free" },
    d: { option: "Only" },
  });
});

test("question phase: waiting, answered, skipped, dismissed", () => {
  const base = { pending: false, settled: true, dismissed: false };
  assert.equal(
    askUserQuestionPhase({ ...base, pending: true, answer: undefined }),
    "waiting",
  );
  assert.equal(
    askUserQuestionPhase({ ...base, settled: false, answer: undefined }),
    "idle",
  );
  assert.equal(
    askUserQuestionPhase({ ...base, answer: { text: "x" } }),
    "answered",
  );
  assert.equal(askUserQuestionPhase({ ...base, answer: undefined }), "skipped");
  assert.equal(
    askUserQuestionPhase({ ...base, dismissed: true, answer: undefined }),
    "dismissed",
  );
});
