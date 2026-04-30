import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { AppShell } from "./components/AppShell";
import { ResearchControlPlane } from "./components/ResearchControlPlane";

export function App() {
  const seedControlPlaneDemo = useMutation(api.orchestration.seedControlPlaneDemo);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const consoleUrl = (import.meta.env.VITE_CONVEX_DASHBOARD_URL as string | undefined) ?? "http://127.0.0.1:6790";

  async function seed() {
    setIsRefreshing(true);
    try {
      await seedControlPlaneDemo();
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <AppShell
      runtimeRoot="convex://control-plane/researchSessions"
      isRefreshing={isRefreshing}
      onRefresh={() => void seed()}
      actionLabel="Seed"
      consoleUrl={consoleUrl}
    >
      <ResearchControlPlane />
    </AppShell>
  );
}
