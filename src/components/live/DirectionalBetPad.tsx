import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { LiveMarketOption, RoutePoint } from "@/types/live";

/**
 * Mobile port of `apps/web/src/components/live/DirectionalBetPad.tsx`.
 *
 * Same layout, same keyword-based direction → option mapping, same
 * inner g-force "blob". Built with `Pressable` + `View` so it works
 * identically on iOS, Android and the Expo web export.
 */

export type Direction = "forward" | "left" | "right" | "back";

const DIRECTION_ORDER: Direction[] = ["forward", "left", "right", "back"];

const DIRECTION_META: Record<
  Direction,
  { icon: string; label: string; danger: boolean; keywords: string[] }
> = {
  forward: {
    icon: "↑",
    label: "Straight",
    danger: false,
    keywords: ["straight", "forward", "ahead", "continue"],
  },
  left: { icon: "←", label: "Left", danger: false, keywords: ["left"] },
  right: { icon: "→", label: "Right", danger: false, keywords: ["right"] },
  back: {
    icon: "↓",
    label: "Back",
    danger: true,
    keywords: ["back", "reverse", "return"],
  },
};

function matchOption(
  options: LiveMarketOption[],
  dir: Direction,
): LiveMarketOption | undefined {
  const { keywords } = DIRECTION_META[dir];
  const byLabel = options.find((o) => {
    const text = `${o.label} ${o.shortLabel ?? ""}`.toLowerCase();
    return keywords.some((k) => text.includes(k));
  });
  if (byLabel) return byLabel;
  const sorted = [...options].sort((a, b) => a.displayOrder - b.displayOrder);
  return sorted[DIRECTION_ORDER.indexOf(dir)];
}

function estimateGForce(points: RoutePoint[] | undefined): {
  x: number;
  y: number;
} {
  if (!points || points.length < 2) return { x: 0, y: 0 };
  const last = points[points.length - 1]!;
  const prev = points[points.length - 2]!;
  const dSpeed = (last.speedMps ?? 0) - (prev.speedMps ?? 0);
  const longG = dSpeed / 9.81;
  let dHead = (last.heading ?? 0) - (prev.heading ?? 0);
  while (dHead > 180) dHead -= 360;
  while (dHead < -180) dHead += 360;
  const latG = ((dHead * Math.PI) / 180) * (last.speedMps ?? 0) / 9.81;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return { x: clamp(latG), y: clamp(longG) };
}

export function DirectionalBetPad({
  options,
  betAmount,
  onBet,
  locked,
  routePoints,
}: {
  options: LiveMarketOption[];
  betAmount: number;
  onBet: (optionId: string, direction: Direction) => Promise<void>;
  locked: boolean;
  routePoints?: RoutePoint[];
}) {
  const [pressing, setPressing] = useState<Direction | null>(null);
  const [flashDir, setFlashDir] = useState<Direction | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gForce = useMemo(() => estimateGForce(routePoints), [routePoints]);
  const gMag = Math.min(1, Math.hypot(gForce.x, gForce.y));
  const activeDir = pressing ?? flashDir;

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  async function handlePress(dir: Direction) {
    if (locked || pressing) return;
    setPressing(dir);
    setFlashDir(dir);
    if (flashTimer.current) clearTimeout(flashTimer.current);

    const opt = matchOption(options, dir);
    if (!opt) {
      setPressing(null);
      flashTimer.current = setTimeout(
        () => setFlashDir((c) => (c === dir ? null : c)),
        500,
      );
      return;
    }

    try {
      await onBet(opt.id, dir);
      setFeedback(`✓ $${betAmount} on ${opt.shortLabel ?? opt.label}`);
      setTimeout(() => setFeedback(null), 3500);
    } finally {
      setPressing(null);
      flashTimer.current = setTimeout(
        () => setFlashDir((c) => (c === dir ? null : c)),
        500,
      );
    }
  }

  const amountLabel = `$${betAmount}`;
  const blobColor = gMag > 0.66 ? "#ef4444" : gMag > 0.33 ? "#f59e0b" : "#22c55e";

  return (
    <View className="items-center">
      <View
        className="mb-1 h-5 items-center justify-center"
        style={{ opacity: feedback ? 1 : 0 }}
      >
        <View className="rounded-full bg-black/60 px-3 py-0.5">
          <Text className="text-[11px] font-semibold text-white">
            {feedback ?? " "}
          </Text>
        </View>
      </View>

      <View className="relative h-36 w-36">
        {/* Center g-meter disc */}
        <View className="absolute inset-[22%] items-center justify-center rounded-full border border-white/15 bg-black/35">
          <View
            style={{
              position: "absolute",
              width: 12,
              height: 12,
              borderRadius: 6,
              backgroundColor: blobColor,
              transform: [
                { translateX: gForce.x * 22 },
                { translateY: -gForce.y * 22 },
              ],
            }}
          />
        </View>

        <DpadButton
          dir="forward"
          activeDir={activeDir}
          locked={locked}
          option={matchOption(options, "forward")}
          onPress={handlePress}
          amountLabel={amountLabel}
          position={{ top: 0, left: 60 }}
        />
        <DpadButton
          dir="left"
          activeDir={activeDir}
          locked={locked}
          option={matchOption(options, "left")}
          onPress={handlePress}
          amountLabel={amountLabel}
          position={{ left: 0, top: 60 }}
        />
        <DpadButton
          dir="right"
          activeDir={activeDir}
          locked={locked}
          option={matchOption(options, "right")}
          onPress={handlePress}
          amountLabel={amountLabel}
          position={{ right: 0, top: 60 }}
        />
        <DpadButton
          dir="back"
          activeDir={activeDir}
          locked={locked}
          option={matchOption(options, "back")}
          onPress={handlePress}
          amountLabel={amountLabel}
          position={{ bottom: 0, left: 60 }}
        />
      </View>
    </View>
  );
}

function DpadButton({
  dir,
  activeDir,
  locked,
  option,
  onPress,
  amountLabel,
  position,
}: {
  dir: Direction;
  activeDir: Direction | null;
  locked: boolean;
  option?: LiveMarketOption;
  onPress: (d: Direction) => void;
  amountLabel: string;
  position: { top?: number; left?: number; right?: number; bottom?: number };
}) {
  const meta = DIRECTION_META[dir];
  const isActive = activeDir === dir;
  const disabled = locked || !option;

  const baseBg = meta.danger ? "#ef4444" : "#10b981";
  const activeBg = "#7c3aed";

  return (
    <Pressable
      disabled={disabled}
      onPress={() => onPress(dir)}
      accessibilityLabel={option?.shortLabel ?? meta.label}
      style={({ pressed }) => ({
        position: "absolute",
        ...position,
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 2,
        borderColor: isActive ? "#c4b5fd" : "rgba(255,255,255,0.4)",
        backgroundColor: isActive ? activeBg : baseBg,
        opacity: disabled ? 0.35 : pressed ? 0.9 : 1,
      })}
    >
      {isActive ? (
        <>
          <Text className="text-[10px] font-bold text-white/90">
            {meta.icon}
          </Text>
          <Text className="text-[13px] font-extrabold text-white">
            {amountLabel}
          </Text>
        </>
      ) : (
        <Text className="text-2xl font-bold text-white">{meta.icon}</Text>
      )}
    </Pressable>
  );
}
