import React from "react";
import { Redirect } from "expo-router";

/**
 * Tab placeholder for "Go Live". The actual navigation is intercepted by the
 * tabPress listener in `(tabs)/_layout.tsx` which pushes `/live/go` directly.
 *
 * This screen is virtually never rendered, but if a deep link or cold start
 * lands here we fall back to a synchronous <Redirect> rather than calling
 * `router.replace` inside useEffect — the latter triggers a Fabric remount
 * race that crashes the Android dev client with
 * `addViewAt: failed to insert view into parent`.
 */
export default function GoTabRedirect() {
  return <Redirect href="/live/go" />;
}
