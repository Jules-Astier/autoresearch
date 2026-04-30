import React from "react";
import ReactDOM from "react-dom/client";
import { AlertTriangle } from "lucide-react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { App } from "./App";
import { LabLedger } from "./v2/LabLedger";
import "./index.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const root = ReactDOM.createRoot(document.getElementById("root")!);

function MissingConvexConfig() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-6 text-ink-100">
      <div className="max-w-lg rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
          <div>
            <h1 className="text-sm font-semibold text-amber-100">Convex backend is not configured</h1>
            <p className="mt-2 text-sm leading-6 text-amber-100/80">
              Run <code className="rounded bg-black/30 px-1.5 py-0.5">npm run convex:dev:local</code> in the frontend
              directory. Convex will write <code className="rounded bg-black/30 px-1.5 py-0.5">VITE_CONVEX_URL</code> to{" "}
              <code className="rounded bg-black/30 px-1.5 py-0.5">.env.local</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Routed() {
  // Pathname-based routing — keeps the parallel dashboard hidden behind /test-ui/
  // until it's ready to replace the existing one.
  const isLab = window.location.pathname.replace(/\/+$/, "") === "/test-ui";
  return isLab ? <LabLedger /> : <App />;
}

root.render(
  <React.StrictMode>
    {convexUrl ? (
      <ConvexProvider client={new ConvexReactClient(convexUrl)}>
        <Routed />
      </ConvexProvider>
    ) : (
      <MissingConvexConfig />
    )}
  </React.StrictMode>
);
