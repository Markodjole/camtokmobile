import React, { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useProposeMarket } from "@/hooks/useLiveRoom";

/**
 * Mobile equivalent of the "user market composer" described in the
 * camtok web README — lets viewers propose a validated market on top of
 * the current live context. Hits `POST /api/live/rooms/:id/markets/propose`.
 */
export function MarketComposerSheet({
  roomId,
  visible,
  onClose,
}: {
  roomId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [option1, setOption1] = useState("");
  const [option2, setOption2] = useState("");
  const [locksInSeconds, setLocksInSeconds] = useState("60");
  const propose = useProposeMarket();

  async function onSubmit() {
    const opts = [option1, option2]
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
    if (title.trim().length < 3 || opts.length < 2) {
      Alert.alert(
        "Incomplete market",
        "Enter a title and at least two options.",
      );
      return;
    }
    try {
      await propose.mutateAsync({
        roomId,
        title: title.trim(),
        options: opts.map((label) => ({ label })),
        locksInSeconds: Number(locksInSeconds) || 60,
      });
      setTitle("");
      setOption1("");
      setOption2("");
      onClose();
      Alert.alert("Proposed", "Your market was sent for validation.");
    } catch (e) {
      Alert.alert(
        "Could not propose",
        e instanceof Error ? e.message : "Unknown error",
      );
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        className="flex-1 justify-end bg-black/70"
        accessibilityLabel="Dismiss market composer"
      >
        <Pressable onPress={() => undefined} className="rounded-t-3xl bg-neutral-950">
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
            >
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-lg font-bold text-white">
                  Propose a market
                </Text>
                <Pressable onPress={onClose} className="rounded-full bg-white/10 px-3 py-1">
                  <Text className="text-xs text-white">Close</Text>
                </Pressable>
              </View>

              <View className="gap-3">
                <Input
                  label="Market title"
                  placeholder="e.g. Will they turn left at the church?"
                  value={title}
                  onChangeText={setTitle}
                />
                <Input
                  label="Option 1"
                  placeholder="Left"
                  value={option1}
                  onChangeText={setOption1}
                />
                <Input
                  label="Option 2"
                  placeholder="Right"
                  value={option2}
                  onChangeText={setOption2}
                />
                <Input
                  label="Locks in (seconds)"
                  placeholder="60"
                  keyboardType="number-pad"
                  value={locksInSeconds}
                  onChangeText={setLocksInSeconds}
                />

                <Text className="text-[11px] text-white/45">
                  Car-mode rooms restrict user markets per the platform safety
                  policy — if your market is rejected, try a walking room.
                </Text>

                <Button
                  label={propose.isPending ? "Submitting…" : "Submit proposal"}
                  onPress={onSubmit}
                  loading={propose.isPending}
                  fullWidth
                />
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
