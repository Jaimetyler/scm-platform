// One read at a time; schedule from completion, not from the start of a request.
export function createVisiblePoller(options: {
  load: (signal: AbortSignal) => Promise<void>;
  intervalMs: number;
  visible: () => boolean;
  onSuccess?: (at: number) => void;
  onError?: (error: unknown) => void;
  onRefreshing?: (value: boolean) => void;
  random?: () => number;
  timeoutMs?: number;
}) {
  let disposed = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let flight: Promise<void> | undefined;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  function schedule() {
    clear();
    if (disposed || !options.visible()) return;
    const base = Math.min(options.intervalMs * 2 ** Math.min(failures, 5), 120_000);
    const jitter = 0.9 + (options.random ?? Math.random)() * 0.2;
    timer = setTimeout(() => { void refresh(); }, Math.min(120_000, base * jitter));
  }
  function refresh(): Promise<void> {
    clear();
    if (disposed || !options.visible()) return Promise.resolve();
    if (flight) return flight;
    const current = new AbortController();
    controller = current;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; current.abort(); }, options.timeoutMs ?? 30_000);
    options.onRefreshing?.(true);
    flight = Promise.resolve().then(() => options.load(current.signal)).then(() => {
      if (!current.signal.aborted && !disposed) { failures = 0; options.onSuccess?.(Date.now()); }
      else if (timedOut && !disposed) { failures += 1; options.onError?.(new Error("Refresh timed out; retrying.")); }
    }).catch((error) => {
      if (!disposed && (!current.signal.aborted || timedOut)) {
        failures += 1; options.onError?.(timedOut ? new Error("Refresh timed out; retrying.") : error);
      }
    }).finally(() => {
      clearTimeout(timeout);
      flight = undefined;
      controller = undefined;
      if (!disposed) { options.onRefreshing?.(false); schedule(); }
    });
    return flight;
  }
  function visibilityChanged() {
    if (!options.visible()) { clear(); controller?.abort(); }
    else if (flight) { void flight.then(() => { if (!disposed && options.visible()) void refresh(); }); }
    else void refresh();
  }
  return {
    refresh, visibilityChanged,
    dispose() { disposed = true; clear(); controller?.abort(); },
  };
}
