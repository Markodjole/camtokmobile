import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { Link } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/providers/AuthProvider";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      Alert.alert(
        "Login failed",
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 justify-center"
      >
        <View className="mb-8 items-center">
          <Text className="text-4xl font-bold tracking-tight text-white">
            <Text className="text-primary">Cam</Text>Tok
          </Text>
          <Text className="mt-2 text-sm text-muted-foreground">
            Watch. Predict. Win.
          </Text>
        </View>
        <Card>
          <CardTitle>Welcome back</CardTitle>
          <CardDescription>Sign in to your account</CardDescription>
          <View className="mt-4 gap-3">
            <Input
              label="Email"
              placeholder="you@example.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Input
              label="Password"
              placeholder="••••••••"
              secureTextEntry
              autoComplete="current-password"
              value={password}
              onChangeText={setPassword}
            />
            <Button
              label={loading ? "Signing in…" : "Sign in"}
              onPress={onSubmit}
              loading={loading}
              fullWidth
            />
            <View className="mt-2 flex-row justify-center">
              <Text className="text-sm text-muted-foreground">
                Don't have an account?{" "}
              </Text>
              <Link href="/(auth)/signup" className="text-sm text-primary">
                Sign up
              </Link>
            </View>
          </View>
        </Card>
      </KeyboardAvoidingView>
    </Screen>
  );
}
