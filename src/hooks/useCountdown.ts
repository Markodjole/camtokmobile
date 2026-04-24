import { useEffect, useState } from "react";

/**
 * Mirrors `components/live/useCountdown` on the web. Returns seconds left
 * until the target ISO timestamp plus a prettified `label` like `12s` or
 * `1m 04s`. Updates once per second.
 */
export function useCountdown(targetIso: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  if (!targetIso) return { secondsLeft: 0, label: "—" };
  const target = Date.parse(targetIso);
  if (!Number.isFinite(target)) return { secondsLeft: 0, label: "—" };
  const secondsLeft = Math.max(0, Math.ceil((target - now) / 1000));
  if (secondsLeft <= 0) return { secondsLeft: 0, label: "locked" };
  if (secondsLeft < 60) return { secondsLeft, label: `${secondsLeft}s` };
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft - mins * 60;
  return { secondsLeft, label: `${mins}m ${secs.toString().padStart(2, "0")}s` };
}
