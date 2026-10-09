"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createVisiblePoller } from "@/lib/polling/visible-poller";

export function useVisiblePolling({ load, intervalMs, enabled = true, requestKey = "" }: {
  load: (signal: AbortSignal) => Promise<void>;
  intervalMs: number;
  enabled?: boolean;
  requestKey?: string;
}) {
  const latest = useRef(load);
  latest.current = load;
  const poller = useRef<ReturnType<typeof createVisiblePoller> | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  useLayoutEffect(() => { setLastSuccessAt(null); setError(""); }, [requestKey]);
  useLayoutEffect(() => {
    setRefreshing(false);
    if (!enabled) return;
    const current = createVisiblePoller({ load: (signal) => latest.current(signal), intervalMs,
      visible: () => document.visibilityState !== "hidden", onSuccess: (at) => { setLastSuccessAt(at); setError(""); },
      onError: () => setError("Refresh delayed; retrying."), onRefreshing: setRefreshing });
    poller.current = current;
    document.addEventListener("visibilitychange", current.visibilityChanged);
    window.addEventListener("online", current.visibilityChanged);
    void current.refresh();
    return () => {
      current.dispose();
      if (poller.current === current) poller.current = null;
      document.removeEventListener("visibilitychange", current.visibilityChanged);
      window.removeEventListener("online", current.visibilityChanged);
    };
  }, [enabled, intervalMs, requestKey]);
  const refresh = useCallback(() => poller.current?.refresh() ?? Promise.resolve(), []);
  return { refresh, lastSuccessAt, refreshing, error };
}
