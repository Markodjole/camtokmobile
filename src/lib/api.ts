import { getSupabase } from "./supabase";
import { env } from "./env";

/**
 * Thin HTTP client that talks to the existing Next.js backend (apps/web).
 *
 * It automatically attaches the current Supabase access token so our API
 * routes can authenticate the caller via `createServerClient().auth.getUser()`
 * — the same pattern the web app uses.
 *
 * Errors are normalised to `ApiError` so screens can render friendly
 * messages without having to inspect the raw `Response`.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: Json;
  signal?: AbortSignal;
  // Skip auth header (e.g. health checks). Default: false.
  anonymous?: boolean;
};

async function getAuthHeader(): Promise<Record<string, string>> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : `${env.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (!opts.anonymous) Object.assign(headers, await getAuthHeader());

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    let msg = `Request failed with ${res.status}`;
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in (parsed as Record<string, unknown>) &&
      typeof (parsed as { error: unknown }).error === "string"
    ) {
      msg = (parsed as { error: string }).error;
    }
    throw new ApiError(msg, res.status, parsed);
  }

  return parsed as T;
}
