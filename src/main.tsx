import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { App } from "./App.tsx";
import { readSharedWorkspace } from "./share.ts";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

// Resolved before the first render rather than inside the app: the editor takes
// its document once, and unpacking a share link is asynchronous because the
// payload is compressed. With no link in the URL this settles in a microtask.
//
// Read, not consumed. The address used to be wiped once the state was in hand,
// so that editing someone's link and reloading kept the edits rather than
// snapping back to what they sent — the app now keeps the address up to date as
// you edit instead, which gets the same thing without the URL going blank.
readSharedWorkspace(window.location.href)
  .catch(() => null)
  .then((shared) => {
    createRoot(container).render(
      <StrictMode>
        <App shared={shared} />
        <Analytics />
      </StrictMode>,
    );
  });
