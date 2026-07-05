import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

// Scaffold shell only. The file-explorer UI (fast directory browsing,
// open-HTML-in-place navigation, publish-to-zink) is built on top of this by
// the follow-on task — see task/0001-file-explorer-mvp.md.
function App() {
  return (
    <main className="mx-auto max-w-2xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">binp-file-explorer</h1>
      <p className="mt-2 text-neutral-600">
        High-speed Bun file explorer — scaffold. Build the explorer UI here.
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
