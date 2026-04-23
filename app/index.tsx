import { Redirect } from "expo-router";

/**
 * Root index redirect. The real routing decision happens in `_layout.tsx`
 * (`AuthGate`) but Expo Router still wants an `index` to render for `/`.
 * We punt to the Live tab; the gate will bounce unauthenticated users to
 * `/auth/login` immediately.
 */
export default function Index() {
  return <Redirect href="/(tabs)/live" />;
}
