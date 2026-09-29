import type * as Code from "./vendors/code.js";
import type * as MathRenderer from "./vendors/math.js";
import type * as Diagram from "./vendors/diagram.js";
import type * as Chart from "./vendors/chart.js";
import type * as Icon from "./vendors/icon.js";
interface Vendors {
  code: typeof Code;
  math: typeof MathRenderer;
  diagram: typeof Diagram;
  chart: typeof Chart;
  icon: typeof Icon;
}
const script = document.currentScript as HTMLScriptElement;
const base = new URL(".", script.src);
const loaded = new Map<string, Promise<unknown>>();
export function load<K extends keyof Vendors>(name: K): Promise<Vendors[K]> {
  if (!loaded.has(name))
    loaded.set(
      name,
      new Promise((resolve, reject) => {
        if (name === "math") {
          const style = document.createElement("link");
          style.rel = "stylesheet";
          style.href = new URL("vendor/math.css", base).href;
          document.head.append(style);
        }
        const element = document.createElement("script");
        element.src = new URL(`vendor/${name}.js`, base).href;
        element.onload = () => {
          const value = (globalThis as unknown as Record<string, unknown>)[
            `Richdoc_${name}`
          ];
          if (value) resolve(value);
          else reject(new Error(`Missing ${name} renderer.`));
        };
        element.onerror = () =>
          reject(new Error(`Unable to load local ${name} renderer.`));
        document.head.append(element);
      }),
    );
  return loaded.get(name) as Promise<Vendors[K]>;
}
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
