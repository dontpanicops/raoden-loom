import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/patterns.css";

// R12j (gate S8): a ring on a control that took the focus by itself (a menu's first row, a dialog's button) shows only after a key, not when the menu or dialog was opened with the mouse
document.addEventListener("keydown", () => { document.documentElement.dataset.kbd = ""; }, true);
document.addEventListener("pointerdown", () => { delete document.documentElement.dataset.kbd; }, true);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
