#!/usr/bin/env node
/**
 * Starts Expo with a personal ngrok tunnel.
 * Expo's shared --tunnel (exp.direct) often fails with "remote gone away"
 * when the shared account hits session limits.
 *
 * Usage: npm run start:tunnel
 * Extra args: npm run start:tunnel -- --clear
 */
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = process.env.EXPO_METRO_PORT || "8081";
const NGROK_BIN = process.env.NGROK_BIN || "ngrok";

function defaultNgrokConfigPath() {
  if (process.env.NGROK_CONFIG) return process.env.NGROK_CONFIG;
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "ngrok",
      "ngrok.yml",
    );
  }
  return path.join(os.homedir(), ".config", "ngrok", "ngrok.yml");
}

function parseForwardedArgs(argv) {
  const sep = argv.indexOf("--");
  if (sep === -1) return [];
  return argv.slice(sep + 1);
}

async function readNgrokPublicUrl() {
  try {
    const res = await fetch("http://127.0.0.1:4040/api/tunnels");
    if (!res.ok) return null;
    const data = await res.json();
    const https = data.tunnels?.find(
      (t) => t.public_url?.startsWith("https://") && t.proto === "https",
    );
    if (https?.public_url) return https.public_url;
    return data.tunnels?.find((t) => t.public_url)?.public_url ?? null;
  } catch {
    return null;
  }
}

async function waitForNgrokPublicUrl(retries = 40) {
  for (let i = 0; i < retries; i++) {
    const url = await readNgrokPublicUrl();
    if (url) return url;
    await sleep(250);
  }
  throw new Error("Timed out waiting for ngrok public URL on :4040");
}

const forwarded = parseForwardedArgs(process.argv.slice(2));
const configPath = defaultNgrokConfigPath();

let ngrok = null;
let ownsNgrok = false;
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (ownsNgrok && ngrok) ngrok.kill("SIGTERM");
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

let publicUrl = await readNgrokPublicUrl();
if (publicUrl) {
  console.log(`Reusing existing ngrok tunnel: ${publicUrl}`);
} else {
  ownsNgrok = true;
  ngrok = spawn(
    NGROK_BIN,
    [
      "http",
      `--config=${configPath}`,
      "--host-header=rewrite",
      String(PORT),
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );

  ngrok.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`ngrok exited unexpectedly (code ${code ?? "?"})`);
      process.exit(code ?? 1);
    }
  });

  try {
    publicUrl = await waitForNgrokPublicUrl();
  } catch (err) {
    console.error(err.message || err);
    ngrok.kill("SIGTERM");
    process.exit(1);
  }
  console.log(`Using personal ngrok tunnel: ${publicUrl}`);
}

const expo = spawn(
  "npx",
  ["expo", "start", "--dev-client", "--lan", ...forwarded],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      EXPO_PACKAGER_PROXY_URL: publicUrl,
      REACT_NATIVE_PACKAGER_HOSTNAME: new URL(publicUrl).hostname,
    },
  },
);

expo.on("exit", (code) => shutdown(code ?? 0));
