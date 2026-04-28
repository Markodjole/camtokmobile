import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { LiveMarketOption, RoutePoint } from "@/types/live";

export type Direction = "forward" | "left" | "right";

const LABELS: Record<Direction, { arrow: string; name: string }> = {
  forward: { arrow: "↑", name: "Forward" },
  left:    { arrow: "←", name: "Left" },
  right:   { arrow: "→", name: "Right" },
};
const ORDER: Direction[] = ["forward", "left", "right"];

function matchOption(options: LiveMarketOption[], dir: Direction) {
  const keywords: Record<Direction, string[]> = {
    forward: ["straight", "forward", "ahead", "continue"],
    left:    ["left"],
    right:   ["right"],
  };
  const kws = keywords[dir];
  const byLabel = options.find((o) =>
    kws.some((k) => `${o.label} ${o.shortLabel ?? ""}`.toLowerCase().includes(k)),
  );
  if (byLabel) return byLabel;
  const sorted = [...options].sort((a, b) => a.displayOrder - b.displayOrder);
  return sorted[ORDER.indexOf(dir)];
}

// ── Layout ────────────────────────────────────────────────────────────────
const BTN  = 52;       // all 3 buttons share the same diameter
const CORE = 60;       // blue centre core diameter
const HALO_PAD = 5;    // translucent ring thickness around each button
const ROW_GAP = -16;   // forward halo overlaps the centre core
const SIDE_GAP = -10;  // side halos overlap the centre core a bit

export function DirectionalBetPad({
  options,
  betAmount,
  onBet,
  locked,
  routePoints: _routePoints,
}: {
  options: LiveMarketOption[];
  betAmount: number;
  onBet: (optionId: string, direction: Direction) => Promise<void>;
  locked: boolean;
  routePoints?: RoutePoint[];
}) {
  const [activeDir, setActiveDir] = useState<Direction>("forward");
  const [busy, setBusy] = useState(false);

  async function press(dir: Direction) {
    if (busy) return;
    setActiveDir(dir);
    if (locked) return;
    setBusy(true);
    try {
      const opt = matchOption(options, dir);
      if (opt) await onBet(opt.id, dir);
    } finally {
      setBusy(false);
    }
  }

  function renderButton(dir: Direction) {
    const lbl = LABELS[dir];
    const isActive = activeDir === dir;
    const isForward = dir === "forward";
    const isDisabled = locked;
    const size = BTN;
    const haloSize = size + HALO_PAD * 2;

    // Three visual states: disabled (grey), pressed, normal/active.
    const idleBg    = isForward ? "#2f7bff" : "#15151a";
    const activeBg  = isForward ? "#1d6fe8" : "#26262d";
    const pressedBg = isForward ? "#1860d6" : "#2d2d36";
    const disabledBg = "#5a5a63";
    const disabledHaloBg = "rgba(90,90,99,0.25)";

    const arrowColor = isDisabled ? "rgba(255,255,255,0.55)" : "#ffffff";

    return (
      <View
        key={dir}
        style={{
          width: haloSize,
          height: haloSize,
          borderRadius: haloSize / 2,
          backgroundColor: isDisabled ? disabledHaloBg : "rgba(20,20,24,0.35)",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2,
        }}
      >
        <Pressable
          onPress={() => void press(dir)}
          disabled={isDisabled}
          accessibilityLabel={lbl.name}
          accessibilityState={{ disabled: isDisabled, selected: isActive }}
          hitSlop={10}
          style={({ pressed }) => ({
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: isDisabled
              ? disabledBg
              : pressed
                ? pressedBg
                : isActive
                  ? activeBg
                  : idleBg,
            borderWidth: isForward && !isDisabled ? 0 : 1,
            borderColor: isDisabled ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.10)",
            opacity: isDisabled ? 0.7 : 1,
            alignItems: "center",
            justifyContent: "center",
            elevation: isDisabled ? 0 : isForward ? 10 : 6,
            shadowColor: isDisabled ? "transparent" : isForward ? "#2f7bff" : "#000",
            shadowOpacity: isDisabled ? 0 : isForward ? 0.7 : 0.6,
            shadowRadius: isDisabled ? 0 : isForward ? 14 : 10,
            shadowOffset: { width: 0, height: isDisabled ? 0 : isForward ? 4 : 3 },
            transform: [{ scale: pressed && !isDisabled ? 0.94 : 1 }],
          })}
        >
          <Text
            style={{
              color: arrowColor,
              fontSize: 22,
              lineHeight: 22,
              fontWeight: "700",
              includeFontPadding: false,
              textAlign: "center",
              textAlignVertical: "center",
              width: size,
              height: 22,
            }}
          >
            {lbl.arrow}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ alignItems: "center", marginTop: -20 }}>
      {/* Forward button on top, slightly overlapping the row below */}
      <View style={{ marginBottom: ROW_GAP, zIndex: 2 }}>
        {renderButton("forward")}
      </View>

      {/* Row: left button | centre core | right button */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {renderButton("left")}

        {/* Blue centre core with glow */}
        <View
          pointerEvents="none"
          style={{
            width: CORE,
            height: CORE,
            borderRadius: CORE / 2,
            backgroundColor: "#2f9cff",
            marginHorizontal: SIDE_GAP,
            shadowColor: "#2f9cff",
            shadowOpacity: 0.95,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 0 },
            elevation: 10,
          }}
        />

        {renderButton("right")}
      </View>
    </View>
  );
}
