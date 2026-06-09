import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";

export type TurnDirection = "left" | "right";

type Props = {
  direction: TurnDirection;
  distanceM?: number | null;
  urgent?: boolean;
};

function TurnArrow({ flip }: { flip: boolean }) {
  return (
    <View
      style={{
        width: 56,
        height: 40,
        transform: [{ scaleX: flip ? -1 : 1 }],
      }}
    >
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 18,
          width: 32,
          height: 4,
          borderRadius: 2,
          backgroundColor: "#ecfdf5",
        }}
      />
      <View
        style={{
          position: "absolute",
          right: 0,
          top: 10,
          width: 0,
          height: 0,
          borderTopWidth: 12,
          borderBottomWidth: 12,
          borderLeftWidth: 20,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderLeftColor: "#d1fae5",
        }}
      />
    </View>
  );
}

/**
 * Blinking left/right turn-signal overlay for the driver map.
 * Mirrors web `TurnBlinkOverlay.tsx`.
 */
export function TurnBlinkOverlay({ direction, distanceM, urgent = false }: Props) {
  const [on, setOn] = useState(true);

  useEffect(() => {
    const interval = urgent ? 520 : 780;
    const id = setInterval(() => setOn((v) => !v), interval);
    return () => clearInterval(id);
  }, [urgent]);

  const color = urgent ? "rgba(34,197,94,0.62)" : "rgba(16,185,129,0.5)";
  const isLeft = direction === "left";

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 20,
      }}
    >
      <View
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: isLeft ? 0 : "50%",
          right: isLeft ? "50%" : 0,
          opacity: on ? 1 : 0.32,
          backgroundColor: color,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            alignItems: "center",
            gap: 8,
            transform: [{ translateX: isLeft ? -24 : 24 }],
          }}
        >
          <View
            style={{
              width: 112,
              height: 112,
              borderRadius: 56,
              borderWidth: 1,
              borderColor: "rgba(167,243,208,0.6)",
              backgroundColor: "rgba(6,78,59,0.35)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <TurnArrow flip={isLeft} />
          </View>
          <View
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: "rgba(110,231,183,0.4)",
              backgroundColor: "rgba(6,78,59,0.75)",
              paddingHorizontal: 12,
              paddingVertical: 4,
            }}
          >
            <Text
              style={{
                color: "#ecfdf5",
                fontSize: 11,
                fontWeight: "800",
                letterSpacing: 1.2,
                textTransform: "uppercase",
              }}
            >
              {isLeft ? "Turn left" : "Turn right"}
              {distanceM != null ? ` · ~${Math.max(0, Math.round(distanceM))}m` : ""}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
