import { toolArgumentSource } from "../lifecycle/argument-source";

export type ExploreDraftTask = {
  key: string;
  index: number;
  count: number;
  label?: string;
  task?: string;
  status: "drafting";
};

export function projectExploreDraftTasks(input: {
  args?: unknown;
  argsText?: string;
}): ExploreDraftTask[] {
  const source = toolArgumentSource(input);
  const taskSources = source.objectArraySources("tasks");
  if (taskSources.length === 0) {
    const task = source.string("task");
    const label = source.string("label");
    return [draftTask(0, 1, label, task)];
  }
  const count = taskSources.length;
  return taskSources.map((taskSource, index) =>
    draftTask(
      index,
      count,
      taskSource.string("label"),
      taskSource.string("task"),
    ),
  );
}

function draftTask(
  index: number,
  count: number,
  label: string | undefined,
  task: string | undefined,
): ExploreDraftTask {
  return {
    key: `task-${index}`,
    index,
    count,
    label,
    task,
    status: "drafting",
  };
}
