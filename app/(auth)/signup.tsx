import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { Link } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/providers/AuthProvider";

export default function SignupScreen() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    if (password.length < 6) {
      Alert.alert("Weak password", "Use at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password);
      Alert.alert(
        "Check your email",
        "We sent a confirmation link. After confirming, come back and sign in.",
      );
    } catch (e) {
      Alert.alert(
        "Sign-up failed",
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
        <Card>
          <CardTitle>Create account</CardTitle>
          <CardDescription>It only takes a minute.</CardDescription>
          <View className="mt-4 gap-3">
            <Input
              label="Email"
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Input
              label="Password"
              placeholder="min. 6 characters"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <Button
              label={loading ? "Creating…" : "Create account"}
              onPress={onSubmit}
              loading={loading}
              fullWidth
            />
            <View className="mt-2 flex-row justify-center">
              <Text className="text-sm text-muted-foreground">
                Already have an account?{" "}
              </Text>
              <Link href="/(auth)/login" className="text-sm text-primary">
                Sign in
              </Link>
            </View>
          </View>
        </Card>
      </KeyboardAvoidingView>
    </Screen>
  );
}
