import { mount } from "svelte";
import "./styles/app.css";
import Root from "./Root.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("Missing #app mount target.");

const app = mount(Root, {
  target,
});

export default app;
