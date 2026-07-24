import type { TaskRecord } from "$lib/api";

export function resolveSelectedTaskId(
  tasks: TaskRecord[],
  selectedTaskId: string | undefined,
): string | undefined {
  if (selectedTaskId && tasks.some((task) => task.id === selectedTaskId)) {
    return selectedTaskId;
  }
  return tasks[0]?.id;
}

export function applyVisibleTaskRecord(
  tasks: TaskRecord[],
  task: TaskRecord,
): TaskRecord[] {
  if (task.visibility === "foreground") {
    return tasks.filter((item) => item.id !== task.id);
  }

  const index = tasks.findIndex((item) => item.id === task.id);
  if (index < 0) return [task, ...tasks];

  return tasks.map((item, itemIndex) => (itemIndex === index ? task : item));
}
