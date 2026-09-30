import { mount, unmount } from "svelte";
import {
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  Check,
  X,
  Plus,
  Minus,
  Info,
  TriangleAlert,
  CircleCheck,
  CircleX,
  Lightbulb,
  Target,
  Clock,
  Calendar,
  User,
  Users,
  FileText,
  Code,
  ChartNoAxesCombined,
  Link,
  ExternalLink,
  Copy,
  Settings,
} from "@lucide/svelte";
const icons = {
  "arrow-right": ArrowRight,
  "arrow-left": ArrowLeft,
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  check: Check,
  x: X,
  plus: Plus,
  minus: Minus,
  info: Info,
  "triangle-alert": TriangleAlert,
  "circle-check": CircleCheck,
  "circle-x": CircleX,
  lightbulb: Lightbulb,
  target: Target,
  clock: Clock,
  calendar: Calendar,
  user: User,
  users: Users,
  "file-text": FileText,
  code: Code,
  "chart-no-axes-combined": ChartNoAxesCombined,
  link: Link,
  "external-link": ExternalLink,
  copy: Copy,
};
export function settings(target: HTMLElement) {
  mount(Settings, { target, props: { size: 18, "aria-hidden": "true" } });
}
export function render(target: HTMLElement, name: string) {
  const component = icons[name as keyof typeof icons];
  if (!component) throw new Error(`Unsupported icon: ${name}`);
  const instance = mount(component, {
    target,
    props: { size: 18, "aria-hidden": "true" },
  });
  return () => {
    void unmount(instance);
  };
}
