import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Single source of truth for runtime configuration.
 *
 * Values are read from Expo public env vars (`EXPO_PUBLIC_*`) first — those
 * are inlined into the JS bundle at build time — and fall back to the
 * `extra` field in `app.json` so the project still works if someone forgets
 * to set env vars locally.
 */

function fromExtra<K extends string>(key: K): string | undefined {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const v = extra[key];
  return typeof v === "string" ? v : undefined;
}

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required env var "${name}". Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function parseHost(value: string | undefined): string | undefined {
  if (!value || value.length === 0) return undefined;
  try {
    if (value.includes("://")) {
      return new URL(value).hostname;
    }
    return value.split("/")[0]?.split(":")[0];
  } catch {
    return undefined;
  }
}

function expoDevHost(): string | undefined {
  const expoConfigHost = parseHost(Constants.expoConfig?.hostUri);
  if (expoConfigHost) return expoConfigHost;
  const linkingHost = parseHost(Constants.linkingUri);
  if (linkingHost) return linkingHost;
  return undefined;
}

function withDeviceReachableHost(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return rawUrl;
  try {
    const url = new URL(rawUrl);
    const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (!isLoopback) return rawUrl;
    const devHost = expoDevHost();
    if (devHost) {
      url.hostname = devHost;
      return url.toString();
    }
    if (Platform.OS === "android") {
      // Android emulators cannot reach host loopback directly; they expose host
      // machine services via 10.0.2.2.
      url.hostname = "10.0.2.2";
      return url.toString();
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

export const env = {
  apiBaseUrl:
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    fromExtra("apiBaseUrl") ??
    "http://localhost:3000",
  supabaseUrl: required(
    "EXPO_PUBLIC_SUPABASE_URL",
    withDeviceReachableHost(
      process.env.EXPO_PUBLIC_SUPABASE_URL ?? fromExtra("supabaseUrl"),
    ),
  ),
  supabaseAnonKey: required(
    "EXPO_PUBLIC_SUPABASE_ANON_KEY",
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? fromExtra("supabaseAnonKey"),
  ),
  turnUrl:
    process.env.EXPO_PUBLIC_TURN_URL ??
    fromExtra("turnUrl") ??
    undefined,
  turnUsername:
    process.env.EXPO_PUBLIC_TURN_USERNAME ??
    fromExtra("turnUsername") ??
    undefined,
  turnCredential:
    process.env.EXPO_PUBLIC_TURN_CREDENTIAL ??
    fromExtra("turnCredential") ??
    undefined,
  iceRelayOnly:
    (process.env.EXPO_PUBLIC_ICE_RELAY_ONLY ?? fromExtra("iceRelayOnly")) === "1",
};
