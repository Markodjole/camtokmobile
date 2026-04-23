import { Alert, Text, View } from "react-native";
import { Screen } from "@/components/ui/Screen";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/providers/AuthProvider";

export default function ProfileTab() {
  const { user, signOut } = useAuth();

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
      <Text className="mb-4 text-2xl font-bold text-white">Profile</Text>

      <Card>
        <CardTitle>{user?.email ?? "Signed out"}</CardTitle>
        <CardDescription>User ID: {user?.id ?? "—"}</CardDescription>
      </Card>

      <View className="mt-6 gap-3">
        <Button
          label="Edit profile"
          variant="secondary"
          onPress={() => Alert.alert("TODO", "Hook up profile editing.")}
        />
        <Button label="Sign out" variant="destructive" onPress={onSignOut} />
      </View>
    </Screen>
  );
}
