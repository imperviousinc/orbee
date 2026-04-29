import { createSignal } from "solid-js";

export type Theme = "dark" | "light";

function readCurrent(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

const [theme, setTheme] = createSignal<Theme>(readCurrent());

if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
  new MutationObserver(() => setTheme(readCurrent()))
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

export { theme };

export function setThemeAttr(next: Theme) {
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("orbee-theme", next); } catch {}
}
