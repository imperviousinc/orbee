import { render } from "solid-js/web";
import "./index.css";
import App from "./App";

try {
  const saved = localStorage.getItem("orbee-theme");
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
} catch {}

render(() => <App />, document.getElementById("app")!);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
