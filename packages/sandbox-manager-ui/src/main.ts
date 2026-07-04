import { mount } from "svelte";
import "./styles/app.css";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("Missing #app mount target.");

export default mount(App, { target });
