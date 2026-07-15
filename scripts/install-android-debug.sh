#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"

echo "Checking adb..."
adb start-server >/dev/null

DEVICES="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
if [ -z "$DEVICES" ]; then
  echo ""
  echo "No adb device yet. Mac USB sees your phone, but adb does not."
  echo ""
  echo "Xiaomi / HyperOS checklist (Xiaomi 15T):"
  echo "  1. Settings → Additional settings → Developer options"
  echo "  2. Turn ON: USB debugging"
  echo "  3. Turn ON: USB debugging (Security settings)  ← often required on Xiaomi"
  echo "  4. Turn ON: Install via USB (if shown)"
  echo "  5. Default USB configuration → File transfer"
  echo "  6. Unplug/replug cable, unlock phone, tap Allow on the RSA prompt"
  echo ""
  echo "Or use Wireless debugging (no cable adb needed):"
  echo "  Phone: Developer options → Wireless debugging → Pair device with pairing code"
  echo "  Mac:   adb pair PHONE_IP:PAIR_PORT"
  echo "         adb connect PHONE_IP:CONNECT_PORT"
  echo "  Then re-run: npm run android:install"
  echo ""
  adb devices -l
  exit 1
fi

if [ ! -f "$APK" ]; then
  echo "APK missing. Building first (JDK 17)..."
  export JAVA_HOME="/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
  (cd "$ROOT/android" && ./gradlew --stop >/dev/null 2>&1 || true)
  (cd "$ROOT" && npm run build:local:android)
fi

echo "Installing debug APK to: $DEVICES"
adb install -r "$APK"
echo "Done. Start Metro with: npm run start:tunnel"
