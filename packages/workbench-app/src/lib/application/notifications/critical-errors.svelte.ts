import { CriticalErrorQueue, errorDetails } from "./critical-error-queue";

export { errorDetails };

export const criticalErrorState = $state(new CriticalErrorQueue());

export function showCriticalError(title: string, details: string): void {
  criticalErrorState.show(title, details);
}

export function acknowledgeCriticalError(): void {
  criticalErrorState.acknowledge();
}
