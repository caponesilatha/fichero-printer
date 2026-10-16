import "$/styles/style.scss";
import "@popperjs/core";
import "toastify-js/src/toastify.css";
import "bootstrap/js/dist/dropdown";
import "bootstrap/js/dist/collapse";
import App from "$/App.svelte";
import { mount } from "svelte";
import { configureFabric } from "$/defaults";
import { logBt } from "$/utils/btlog";

// Show uncaught errors in the on-page log panel (phones have no console).
window.addEventListener("error", (e) => logBt(`JS error: ${e.message} (${e.filename?.split("/").pop()}:${e.lineno})`));
window.addEventListener("unhandledrejection", (e) => logBt(`Unhandled error: ${e.reason?.message ?? e.reason}`));

configureFabric();

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
