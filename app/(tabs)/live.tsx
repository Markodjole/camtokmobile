import React from "react";
import { Redirect } from "expo-router";

/**
 * Viewer feed is disabled on mobile — send everyone to the driver go-live flow.
 */
export default function LiveTab() {
  return <Redirect href="/live/go" />;
}
