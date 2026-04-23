import Constants from "expo-constants";

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

export const env = {
  apiBaseUrl:
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    fromExtra("apiBaseUrl") ??
    "http://localhost:3000",
  supabaseUrl: required(
    "EXPO_PUBLIC_SUPABASE_URL",
    process.env.EXPO_PUBLIC_SUPABASE_URL ?? fromExtra("supabaseUrl"),
  ),
  supabaseAnonKey: required(
    "EXPO_PUBLIC_SUPABASE_ANON_KEY",
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? fromExtra("supabaseAnonKey"),
  ),
};
