import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * Supabase storage adapter that keeps the auth token in the platform
 * Keychain / Keystore via expo-secure-store, and falls back to
 * AsyncStorage on web (SecureStore is native-only).
 *
 * SecureStore has a 2 KB per-value limit which is more than enough for
 * a JWT session, but if we ever store bigger blobs we should switch back
 * to AsyncStorage for those keys.
 */
const secureStorage = {
  async getItem(key: string) {
    try {
      const secureValue = await SecureStore.getItemAsync(key);
      if (secureValue != null) return secureValue;
      return await AsyncStorage.getItem(key);
    } catch {
      return AsyncStorage.getItem(key);
    }
  },
  async setItem(key: string, value: string) {
    // SecureStore warns for values around/over 2KB. Supabase session payloads
    // can occasionally exceed that, so store larger values in AsyncStorage.
    const shouldUseAsyncStorage = value.length > 1800;
    try {
      if (shouldUseAsyncStorage) {
        await AsyncStorage.setItem(key, value);
        await SecureStore.deleteItemAsync(key);
      } else {
        await SecureStore.setItemAsync(key, value);
        await AsyncStorage.removeItem(key);
      }
    } catch {
      await AsyncStorage.setItem(key, value);
    }
  },
  async removeItem(key: string) {
    try {
      await SecureStore.deleteItemAsync(key);
      await AsyncStorage.removeItem(key);
    } catch {
      await AsyncStorage.removeItem(key);
    }
  },
};

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      storage: secureStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return cached;
}
