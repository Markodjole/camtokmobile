import React from "react";
import { Text, View } from "react-native";
import { leadVehicleDebugOverlayEnabled } from "../config/leadVehicle.flags";
import type { ForwardCorridor } from "../domain/leadVehicle.types";
import { useLeadVehicleStore } from "../state/leadVehicle.store";

type Props = {
  /** Absolute fill over the camera / map preview. */
  visible?: boolean;
};

/**
 * Dev / internal overlay. Never shown to ordinary riders in production
 * unless EXPO_PUBLIC_LEAD_VEHICLE_DEBUG_OVERLAY=1.
 * Does not bake into the outgoing WebRTC stream.
 */
export function LeadVehicleDebugOverlay({ visible = true }: Props) {
  const enabled = leadVehicleDebugOverlayEnabled();
  const status = useLeadVehicleStore((s) => s.status);
  const lead = useLeadVehicleStore((s) => s.leadVehicle);
  const tracks = useLeadVehicleStore((s) => s.tracks);
  const detections = useLeadVehicleStore((s) => s.detections);
  const readiness = useLeadVehicleStore((s) => s.predictionReadiness);
  const metrics = useLeadVehicleStore((s) => s.metrics);
  const score = useLeadVehicleStore((s) => s.scoreBreakdown);
  const corridor = useLeadVehicleStore((s) => s.corridor);

  if (!enabled || !visible) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 50,
      }}
    >
      <CorridorOutline corridor={corridor} />
      {detections.map((d, i) => (
        <Box
          key={`det-${i}`}
          box={d.boundingBox}
          color="rgba(250,204,21,0.85)"
          label={`${d.vehicleType} ${(d.confidence * 100).toFixed(0)}%`}
        />
      ))}
      {tracks.map((t) => {
        const isLead = lead?.trackId === t.trackId;
        return (
          <Box
            key={t.trackId}
            box={t.boundingBox}
            color={isLead ? "rgba(34,197,94,0.95)" : "rgba(96,165,250,0.8)"}
            label={`${t.trackId} ${t.vehicleType}`}
            thick={isLead}
          />
        );
      })}
      <View
        style={{
          position: "absolute",
          left: 8,
          top: 8,
          maxWidth: "92%",
          borderRadius: 10,
          backgroundColor: "rgba(0,0,0,0.72)",
          paddingHorizontal: 10,
          paddingVertical: 8,
          gap: 2,
        }}
      >
        <Text style={line}>state: {status}</Text>
        <Text style={line}>
          fps {metrics.inferenceFps.toFixed(1)} · infer{" "}
          {metrics.averageInferenceDurationMs.toFixed(0)}ms · drop{" "}
          {metrics.droppedAnalysisFrames} · tracks {metrics.trackerCount}
        </Text>
        {lead ? (
          <>
            <Text style={line}>
              lead {lead.trackId} · {lead.vehicleType} · {lead.relativeState}
            </Text>
            <Text style={line}>
              conf {lead.confidence.toFixed(2)} · sameDir{" "}
              {lead.sameDirectionConfidence.toFixed(2)} · corridor{" "}
              {lead.corridorConfidence.toFixed(2)}
            </Text>
            {score ? (
              <Text style={line}>score {score.totalScore.toFixed(2)}</Text>
            ) : null}
          </>
        ) : (
          <Text style={line}>lead: none</Text>
        )}
        <Text style={line}>
          prediction {readiness.ready ? "READY" : "blocked"} (
          {readiness.confidence.toFixed(2)})
        </Text>
        {readiness.blockers.length > 0 ? (
          <Text style={line}>blockers: {readiness.blockers.join(", ")}</Text>
        ) : (
          <Text style={line}>reasons: {readiness.reasons.join(", ")}</Text>
        )}
      </View>
    </View>
  );
}

function Box({
  box,
  color,
  label,
  thick,
}: {
  box: { x: number; y: number; width: number; height: number };
  color: string;
  label: string;
  thick?: boolean;
}) {
  return (
    <View
      style={{
        position: "absolute",
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.width * 100}%`,
        height: `${box.height * 100}%`,
        borderWidth: thick ? 3 : 1.5,
        borderColor: color,
      }}
    >
      <Text
        style={{
          color,
          fontSize: 9,
          fontWeight: "700",
          backgroundColor: "rgba(0,0,0,0.55)",
          paddingHorizontal: 2,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

function CorridorOutline({ corridor }: { corridor: ForwardCorridor }) {
  // Approximate trapezoid with three horizontal guides (top / mid / bottom).
  const midY = (corridor.topY + corridor.bottomY) / 2;
  const midLeft =
    (corridor.topLeftX + corridor.bottomLeftX) / 2;
  const midRight =
    (corridor.topRightX + corridor.bottomRightX) / 2;
  return (
    <>
      <View
        style={{
          position: "absolute",
          left: `${corridor.topLeftX * 100}%`,
          top: `${corridor.topY * 100}%`,
          width: `${(corridor.topRightX - corridor.topLeftX) * 100}%`,
          height: 2,
          backgroundColor: "rgba(248,113,113,0.7)",
        }}
      />
      <View
        style={{
          position: "absolute",
          left: `${midLeft * 100}%`,
          top: `${midY * 100}%`,
          width: `${(midRight - midLeft) * 100}%`,
          height: 2,
          backgroundColor: "rgba(248,113,113,0.45)",
        }}
      />
      <View
        style={{
          position: "absolute",
          left: `${corridor.bottomLeftX * 100}%`,
          top: `${corridor.bottomY * 100}%`,
          width: `${(corridor.bottomRightX - corridor.bottomLeftX) * 100}%`,
          height: 2,
          backgroundColor: "rgba(248,113,113,0.7)",
        }}
      />
    </>
  );
}

const line = {
  color: "#e4e4e7",
  fontSize: 10,
  fontWeight: "600" as const,
};
