import WebSocket from "ws";
import { CliError } from "../../cli/main.ts";

type Params = Record<string, unknown>;

/** The CDP response/event envelope fields this benchmark reads. */
interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string };
}

interface EvaluateResult {
  result: { value?: unknown };
  exceptionDetails?: { text: string; exception?: { description?: string } };
}

export class Cdp {
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly listeners = new Map<string, Set<(params: never) => void>>();

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const message = JSON.parse(String(data)) as CdpMessage;
      if (message.id !== undefined) {
        const waiter = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error)
          waiter?.reject(new Error(`${message.error.message}`));
        else waiter?.resolve(message.result);
      } else {
        for (const listener of this.listeners.get(message.method ?? "") ?? [])
          listener(message.params as never);
      }
    });
  }

  static async connect(endpoint: string): Promise<Cdp> {
    const targets = (await (await fetch(`${endpoint}/json`)).json()) as {
      type: string;
      webSocketDebuggerUrl: string;
    }[];
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new CliError(`No page target at ${endpoint}/json`);
    const socket = new WebSocket(page.webSocketDebuggerUrl, {
      perMessageDeflate: false,
      maxPayload: 1 << 30,
    });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new Cdp(socket);
  }

  send<T = unknown>(method: string, params: Params = {}): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on<P>(method: string, listener: (params: P) => void): () => void {
    const set = this.listeners.get(method) ?? new Set();
    set.add(listener as (params: never) => void);
    this.listeners.set(method, set);
    return () => set.delete(listener as (params: never) => void);
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.send<EvaluateResult>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        `evaluate failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
      );
    return result.result.value as T;
  }

  close(): void {
    this.socket.close();
  }
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(
  cdp: Cdp,
  expression: string,
  what: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(`Boolean(${expression})`)) return;
    await sleep(100);
  }
  throw new CliError(`Timed out waiting for ${what}`);
}

/** Trusted mouse click at the centre of the first element matching `selector`. */
export async function click(
  cdp: Cdp,
  selector: string,
  text?: string,
): Promise<void> {
  const point = await cdp.evaluate<[number, number] | null>(`(() => {
    const wanted = ${JSON.stringify(text ?? null)};
    const matches = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(
      (e) => e.getBoundingClientRect().width > 0 && (wanted === null || e.textContent.includes(wanted)),
    );
    const el = wanted === null ? matches[0] : matches.at(-1); // deepest match for text lookups
    if (!el) return null;
    el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  })()`);
  if (!point) throw new CliError(`No element for ${selector}`);
  const [x, y] = point;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  for (const type of ["mousePressed", "mouseReleased"])
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      clickCount: 1,
      buttons: type === "mousePressed" ? 1 : 0,
    });
}

export async function typeText(cdp: Cdp, text: string): Promise<void> {
  await cdp.send("Input.insertText", { text });
}

export async function pressEnter(cdp: Cdp): Promise<void> {
  for (const type of ["keyDown", "keyUp"])
    await cdp.send("Input.dispatchKeyEvent", {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      text: type === "keyDown" ? "\r" : undefined,
    });
}
