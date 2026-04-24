import React from "react";
import { Text, View } from "react-native";

/**
 * Placeholder for the broadcaster's live video. The web app uses WebRTC
 * (see `apps/web/src/components/live/LiveVideoPlayer.tsx`). On mobile
 * we render a solid background with a pulsing "LIVE" dot until a
 * react-native-webrtc based dev client is wired in.
 */
export function LiveVideoPlaceholder({
  characterName,
  statusText,
}: {
  characterName: string;
  statusText: string | null;
}) {
  return (
    <View className="flex-1 items-center justify-center bg-neutral-900">
      <View className="h-24 w-24 items-center justify-center rounded-full bg-neutral-800">
        <Text className="text-3xl">📡</Text>
      </View>
      <Text className="mt-4 text-base font-semibold text-white">
        {characterName}
      </Text>
      {statusText ? (
        <Text className="mt-1 px-8 text-center text-sm text-white/60">
          {statusText}
        </Text>
      ) : null}
      <Text className="mt-6 text-xs text-white/40">
        Live video shows here when broadcaster is connected.
      </Text>
    </View>
  );
}
