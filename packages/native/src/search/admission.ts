// Admission covers cold JS preparation, append tasks, and failure disposal.
let activeBuilds = 0;
const waitingBuilds: { enter(): void }[] = [];
export async function acquireBuildSlot(
  signal?: AbortSignal,
): Promise<() => void> {
  signal?.throwIfAborted();
  if (activeBuilds >= 2 && waitingBuilds.length >= 16)
    throw new Error("Completion build queue is full");
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = waitingBuilds.indexOf(request);
      if (index >= 0) waitingBuilds.splice(index, 1);
      reject(signal?.reason ?? new Error("Completion build aborted"));
    };
    const request = {
      enter() {
        signal?.removeEventListener("abort", abort);
        activeBuilds++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          activeBuilds--;
          waitingBuilds.shift()?.enter();
        });
      },
    };
    if (activeBuilds < 2) request.enter();
    else {
      waitingBuilds.push(request);
      signal?.addEventListener("abort", abort, { once: true });
    }
  });
}
