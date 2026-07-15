import { Linking, Pressable, Text, View } from "react-native";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import type { BroadcastPermissionsSnapshot } from "@/lib/broadcastPermissions";

type Props = {
  snapshot: BroadcastPermissionsSnapshot | null;
  requesting: boolean;
  onRequestAll: () => void;
  onOpenSettings: () => void;
};

export function BroadcastPermissionsCard({
  snapshot,
  requesting,
  onRequestAll,
  onOpenSettings,
}: Props) {
  if (!snapshot) {
    return (
      <Card>
        <CardTitle>Permissions</CardTitle>
        <CardDescription>Checking camera, microphone, and location…</CardDescription>
      </Card>
    );
  }

  if (snapshot.ready) {
    return null;
  }

  const blocked = snapshot.permissions.some(
    (p) => p.required && !p.granted && !p.canAskAgain,
  );

  return (
    <Card>
      <CardTitle>Permissions required</CardTitle>
      <CardDescription>
        Allow these before you go live so video, vehicle detection, and your map
        position work without extra prompts in the stream.
      </CardDescription>

      <View className="mt-3" style={{ gap: 8 }}>
        {snapshot.permissions.map((p) => (
          <View
            key={p.id}
            className="flex-row items-start gap-2 rounded-xl border border-border bg-black/30 px-3 py-2"
          >
            <Text className="text-base">{p.granted ? "✅" : "⬜"}</Text>
            <View className="flex-1">
              <Text className="text-sm font-semibold text-white">
                {p.label}
                {!p.required ? " (recommended)" : ""}
              </Text>
              <Text className="text-xs text-muted-foreground">{p.detail}</Text>
            </View>
          </View>
        ))}
      </View>

      <Pressable
        onPress={() => {
          if (blocked) {
            void onOpenSettings();
            return;
          }
          onRequestAll();
        }}
        disabled={requesting}
        className="mt-4 items-center rounded-full bg-primary px-4 py-3"
        style={{ opacity: requesting ? 0.7 : 1 }}
      >
        <Text className="text-sm font-semibold text-white">
          {requesting
            ? "Requesting…"
            : blocked
              ? "Open Settings"
              : "Allow all permissions"}
        </Text>
      </Pressable>

      {blocked ? (
        <Pressable onPress={() => void Linking.openSettings()} className="mt-2 py-2">
          <Text className="text-center text-xs text-muted-foreground">
            Some permissions were denied permanently — enable them in system settings.
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}
