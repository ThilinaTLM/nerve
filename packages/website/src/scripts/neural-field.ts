type NeuralNode = { x: number; y: number; vx: number; vy: number };

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const coarse = matchMedia("(pointer: coarse)");

function start(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  let nodes: NeuralNode[] = [];
  let frame = 0;
  let visible = true;
  let pointer: { x: number; y: number } | null = null;
  let primary = "#d97706";
  let muted = "#78716c";

  const colors = (): void => {
    const styles = getComputedStyle(document.documentElement);
    primary = styles.getPropertyValue("--primary").trim() || primary;
    muted = styles.getPropertyValue("--muted-foreground").trim() || muted;
  };
  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = rect.width < 768 ? 24 : 42;
    nodes = Array.from({ length: count }, (_, index) => ({
      x: ((index * 73) % 101) / 101 * rect.width,
      y: ((index * 47 + 19) % 103) / 103 * rect.height,
      vx: (((index * 31) % 9) - 4) * 0.018,
      vy: (((index * 17) % 9) - 4) * 0.018,
    }));
  };
  const paint = (time = 0): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    context.clearRect(0, 0, width, height);
    for (let a = 0; a < nodes.length; a++) {
      const node = nodes[a];
      if (!reduced.matches) {
        node.x = (node.x + node.vx + width) % width;
        node.y = (node.y + node.vy + height) % height;
      }
      for (let b = a + 1; b < nodes.length; b++) {
        const other = nodes[b];
        const distance = Math.hypot(node.x - other.x, node.y - other.y);
        if (distance > 150) continue;
        context.globalAlpha = (1 - distance / 150) * 0.22;
        context.strokeStyle = muted;
        context.beginPath(); context.moveTo(node.x, node.y); context.lineTo(other.x, other.y); context.stroke();
      }
      const near = pointer ? Math.max(0, 1 - Math.hypot(node.x - pointer.x, node.y - pointer.y) / 180) : 0;
      context.globalAlpha = 0.42 + near * 0.58;
      context.fillStyle = near > 0.1 ? primary : muted;
      context.beginPath(); context.arc(node.x, node.y, 1.5 + near * 2.5, 0, Math.PI * 2); context.fill();
    }
    const pulse = nodes[Math.floor(time / 900) % nodes.length];
    if (pulse) { context.globalAlpha = 0.9; context.fillStyle = primary; context.beginPath(); context.arc(pulse.x, pulse.y, 4, 0, Math.PI * 2); context.fill(); }
    context.globalAlpha = 1;
    if (!reduced.matches && visible) frame = requestAnimationFrame(paint);
  };
  const restart = (): void => { cancelAnimationFrame(frame); colors(); paint(); };
  new ResizeObserver(() => { resize(); restart(); }).observe(canvas);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) restart(); else cancelAnimationFrame(frame); }).observe(canvas);
  if (!coarse.matches) {
    canvas.parentElement?.addEventListener("pointermove", (event) => { const rect = canvas.getBoundingClientRect(); pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }; });
    canvas.parentElement?.addEventListener("pointerleave", () => { pointer = null; });
  }
  document.addEventListener("theme:change", restart);
  colors(); resize(); paint();
}

for (const canvas of document.querySelectorAll<HTMLCanvasElement>("[data-neural-field]")) start(canvas);
