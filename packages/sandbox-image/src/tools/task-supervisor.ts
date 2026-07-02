export type SupervisedTask = {
  id: string;
  command: string;
  startedAt: string;
  status: "running" | "completed" | "failed" | "cancelled";
};
export class TaskSupervisor {
  private readonly tasks = new Map<string, SupervisedTask>();
  start(command: string): SupervisedTask {
    const task = {
      id: `task_${Date.now()}`,
      command,
      startedAt: new Date().toISOString(),
      status: "running" as const,
    };
    this.tasks.set(task.id, task);
    return task;
  }
  list(): SupervisedTask[] {
    return Array.from(this.tasks.values());
  }
}
