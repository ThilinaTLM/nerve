import type { TaskRecord } from "$lib/api";

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
