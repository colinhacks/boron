import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { consumeSharedWorkspace } from "./workspace.ts";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

// Resolved before the first render rather than inside the app: the editor takes
// its initial document once and never again, and unpacking a share link is
// asynchronous because the payload is compressed. Without a link in the URL this
// settles in a microtask.
consumeSharedWorkspace()
  .catch(() => null)
  .then((shared) => {
    createRoot(container).render(
      <StrictMode>
        <App shared={shared} />
      </StrictMode>,
    );
  });
