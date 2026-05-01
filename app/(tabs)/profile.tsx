import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/components/ui/Screen";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/providers/AuthProvider";
import { getSupabase } from "@/lib/supabase";
import {
  type ComfortVsSpeed,
  type DrivingRouteStyle,
  type PathStyle,
  normalizeDrivingRouteStyle,
} from "@/lib/drivingRouteStyle";

type CharacterDrivingRow = {
  id: string;
  name: string;
  driving_route_style: unknown;
};

const COMFORT_OPTS: { value: ComfortVsSpeed; label: string }[] = [
  { value: "comfort", label: "Comfort first" },
  { value: "balanced", label: "Balanced" },
  { value: "speed", label: "Fastest sensible" },
];

const PATH_OPTS: { value: PathStyle; label: string }[] = [
  { value: "smooth", label: "Smoother / avoid highways" },
  { value: "balanced", label: "Balanced" },
  { value: "direct", label: "Direct / shortcuts OK" },
];

export default function ProfileTab() {
  const { user, signOut } = useAuth();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const charactersQuery = useQuery({
    queryKey: ["profile-characters-driving", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<CharacterDrivingRow[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("characters")
        .select("id, name, driving_route_style")
        .eq("creator_user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as CharacterDrivingRow[];
    },
  });

  const primary = charactersQuery.data?.[0] ?? null;
  const [draft, setDraft] = useState<DrivingRouteStyle>(() =>
    normalizeDrivingRouteStyle(null),
  );

  useEffect(() => {
    if (primary) {
      setDraft(normalizeDrivingRouteStyle(primary.driving_route_style));
    }
  }, [primary?.id, JSON.stringify(primary?.driving_route_style)]);

  const persistStyle = useCallback(async () => {
    if (!user?.id || !primary) {
      Alert.alert("No driver profile", "Create a character on the web onboarding first.");
      return;
    }
    setSaving(true);
    try {
      const supabase = getSupabase();
      const payload = {
        version: 1 as const,
        comfortVsSpeed: draft.comfortVsSpeed,
        pathStyle: draft.pathStyle,
        ecoConscious: draft.ecoConscious,
      };
      const { error } = await supabase
        .from("characters")
        .update({ driving_route_style: payload as never })
        .eq("id", primary.id)
        .eq("creator_user_id", user.id);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["profile-characters-driving", user.id] });
      Alert.alert("Saved", "Routing preferences updated for your next live session.");
    } catch (e) {
      Alert.alert(
        "Could not save",
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      setSaving(false);
    }
  }, [user?.id, primary, draft, qc]);

  async function onSignOut() {
    try {
      await signOut();
    } catch (e) {
      Alert.alert(
        "Could not sign out",
        e instanceof Error ? e.message : "Unknown error",
      );
    }
  }

  return (
    <Screen>
      <ScrollView className="flex-1 px-4 pb-8" keyboardShouldPersistTaps="handled">
        <Text className="mb-4 text-2xl font-bold text-white">Profile</Text>

        <Card>
          <CardTitle>{user?.email ?? "Signed out"}</CardTitle>
          <CardDescription>
            Tune how navigation behaves while you stream (matches web driver onboarding).
          </CardDescription>
        </Card>

        <Text className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Live routing — {primary?.name ?? "no character yet"}
        </Text>

        {!primary ? (
          <Text className="mb-4 text-sm text-zinc-400">
            Create your driver character on camtok web onboarding first; then edit routing here or on the web.
          </Text>
        ) : (
          <Card className="mb-4 border-sky-500/20 bg-zinc-900/85">
            <Text className="text-base font-bold tracking-tight text-white">
              Route persona
            </Text>
            <Text className="mt-1 text-xs leading-5 text-zinc-400">
              Affects Google directions, blue decision pins, and tags viewers see on the map.
            </Text>

            <Text className="mt-4 text-[11px] font-semibold uppercase text-zinc-500">
              Comfort vs speed
            </Text>
            <View className="mt-2 flex-row flex-wrap gap-2">
              {COMFORT_OPTS.map((o) => (
                <Pressable
                  key={o.value}
                  onPress={() =>
                    setDraft((d) => ({ ...d, comfortVsSpeed: o.value }))
                  }
                  className={`rounded-full border px-3 py-2 ${
                    draft.comfortVsSpeed === o.value
                      ? "border-sky-400 bg-sky-500/25"
                      : "border-zinc-600 bg-zinc-800/80"
                  }`}
                >
                  <Text className="text-xs font-medium text-white">{o.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text className="mt-4 text-[11px] font-semibold uppercase text-zinc-500">
              Path style
            </Text>
            <View className="mt-2 flex-row flex-wrap gap-2">
              {PATH_OPTS.map((o) => (
                <Pressable
                  key={o.value}
                  onPress={() => setDraft((d) => ({ ...d, pathStyle: o.value }))}
                  className={`rounded-full border px-3 py-2 ${
                    draft.pathStyle === o.value
                      ? "border-sky-400 bg-sky-500/25"
                      : "border-zinc-600 bg-zinc-800/80"
                  }`}
                >
                  <Text className="text-xs font-medium text-white">{o.label}</Text>
                </Pressable>
              ))}
            </View>

            <View className="mt-4 flex-row items-center justify-between gap-3">
              <View className="flex-1">
                <Text className="text-sm font-medium text-white">Eco & toll saver</Text>
                <Text className="text-[11px] text-zinc-500">
                  Prefer fewer tolls when the API supports it.
                </Text>
              </View>
              <Switch
                value={draft.ecoConscious}
                onValueChange={(v) => setDraft((d) => ({ ...d, ecoConscious: v }))}
              />
            </View>

            <View className="mt-5">
              <Button
                label={saving ? "Saving…" : "Save routing preferences"}
                onPress={() => void persistStyle()}
                loading={saving}
                fullWidth
              />
            </View>
          </Card>
        )}

        <View className="mt-6 gap-3">
          <Button label="Sign out" variant="destructive" onPress={() => void onSignOut()} />
        </View>
      </ScrollView>
    </Screen>
  );
}
