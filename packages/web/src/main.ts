import { mount } from "svelte";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-600.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "./design/globals.css";
import Root from "./Root.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("Missing #app mount target.");

const app = mount(Root, {
  target,
});

export default app;
