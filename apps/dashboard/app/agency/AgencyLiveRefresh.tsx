"use client";

import { useEffect, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";

export default function AgencyLiveRefresh({
  enabled,
  intervalMs = 4000,
}: {
  enabled: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const refreshDashboardRef = useRef<() => void>(() => {});

  refreshDashboardRef.current = () => {
    if (document.visibilityState !== "visible" || !navigator.onLine) {
      return;
    }

    startTransition(() => {
      router.refresh();
    });
    setLastRefreshAt(new Date());
  };

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const interval = window.setInterval(() => {
      refreshDashboardRef.current();
    }, intervalMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [enabled, intervalMs]);

  if (!enabled) {
    return null;
  }

  return (
    <div className="documentation-alert">
      <div className="documentation-alert-header">
        <div>
          <strong>Live Dashboard Refresh</strong>
          <div className="muted">
            The agency dashboard refreshes automatically every {Math.round(intervalMs / 1000)} seconds while the backend
            is still building patient QA views.
          </div>
        </div>
        <span className="badge warning">
          {lastRefreshAt
            ? `Last sync ${lastRefreshAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`
            : "Waiting for first sync"}
        </span>
      </div>
    </div>
  );
}
