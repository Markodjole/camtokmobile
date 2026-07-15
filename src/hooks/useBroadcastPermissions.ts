import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkBroadcastPermissions,
  openBroadcastPermissionSettings,
  requestAllBroadcastPermissions,
  type BroadcastPermissionsSnapshot,
} from "@/lib/broadcastPermissions";

export function useBroadcastPermissions(options?: { autoRequest?: boolean }) {
  const autoRequest = options?.autoRequest !== false;
  const [snapshot, setSnapshot] = useState<BroadcastPermissionsSnapshot | null>(
    null,
  );
  const [requesting, setRequesting] = useState(false);
  const promptedRef = useRef(false);

  const refresh = useCallback(async () => {
    const next = await checkBroadcastPermissions();
    setSnapshot(next);
    return next;
  }, []);

  const requestAll = useCallback(async () => {
    setRequesting(true);
    try {
      const next = await requestAllBroadcastPermissions();
      setSnapshot(next);
      return next;
    } finally {
      setRequesting(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const current = await checkBroadcastPermissions();
      if (cancelled) return;
      setSnapshot(current);

      if (!autoRequest || promptedRef.current || current.ready) return;
      promptedRef.current = true;
      setRequesting(true);
      try {
        const next = await requestAllBroadcastPermissions();
        if (!cancelled) setSnapshot(next);
      } finally {
        if (!cancelled) setRequesting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [autoRequest]);

  return {
    snapshot,
    requesting,
    ready: snapshot?.ready ?? false,
    refresh,
    requestAll,
    openSettings: openBroadcastPermissionSettings,
  };
}
