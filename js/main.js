import { initDOM } from "./dom.js";
import { Handlers, initGame } from "./game.js";

function getModeFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const mode = (params.get("mode") || "").toLowerCase();

  if (mode === "randomstart" || mode === "random") return "random";
  if (mode === "stats") return "stats";
  if (mode === "versus") return "versus";
  return null;
}

function isPlayEntryPage() {
  const pathname = (window.location.pathname || "").toLowerCase();
  return pathname.endsWith("/play.html") || pathname.endsWith("play.html");
}

function startMode(mode) {
  if (!mode) return;

  if (mode === "random") {
    Handlers.onStartRandom();
    return;
  }
  if (mode === "stats") {
    Handlers.onStartStats();
    return;
  }
  if (mode === "versus" && typeof Handlers.onStartVersus === "function") {
    Handlers.onStartVersus();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const mode = getModeFromQuery();
  initDOM(Handlers);

  if (!mode) {
    if (isPlayEntryPage()) {
      initGame({ initialScreen: "mode-selection-screen" });
      return;
    }
    window.location.replace("index.html");
    return;
  }

  initGame({ initialScreen: "game-container" });
  startMode(mode);
});
