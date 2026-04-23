import React, { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import type { LiveMarket } from "@/types/live";
import { usePlaceBet } from "@/hooks/useLiveRoom";

const STAKES = [1, 5, 10, 25] as const;

export function BettingPanel({
  roomId,
  market,
  balance,
}: {
  roomId: string;
  market: LiveMarket | null;
  balance?: number;
}) {
  const [stake, setStake] = useState<number>(5);
  const [selected, setSelected] = useState<string | null>(null);
  const placeBet = usePlaceBet(roomId);

  if (!market) {
    return (
      <View className="rounded-t-3xl bg-muted/90 p-4">
        <Text className="text-center text-sm text-muted-foreground">
          Waiting for the next decision point…
        </Text>
      </View>
    );
  }

  const locked = market.status !== "open";

  async function onConfirm() {
    if (!selected) return;
    try {
      await placeBet.mutateAsync({
        marketId: market!.id,
        optionId: selected,
        stake,
      });
      setSelected(null);
    } catch (e) {
      Alert.alert(
        "Bet failed",
        e instanceof Error ? e.message : "Unknown error",
      );
    }
  }

  return (
    <View className="rounded-t-3xl border-t border-border bg-muted/95 p-4">
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-base font-semibold text-white">
          {market.prompt}
        </Text>
        <View
          className={`rounded-full px-2 py-0.5 ${
            locked ? "bg-accent/20" : "bg-success/20"
          }`}
        >
          <Text
            className={`text-xs font-semibold ${
              locked ? "text-accent" : "text-success"
            }`}
          >
            {locked ? "LOCKED" : "BETS OPEN"}
          </Text>
        </View>
      </View>

      <View className="flex-row flex-wrap gap-2">
        {market.options
          .slice()
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((opt) => {
            const isSelected = selected === opt.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() => !locked && setSelected(opt.id)}
                className={`min-w-[48%] flex-1 rounded-2xl border px-3 py-3 ${
                  isSelected
                    ? "border-primary bg-primary/15"
                    : "border-border bg-black/30"
                } ${locked ? "opacity-50" : ""}`}
              >
                <Text className="text-sm font-semibold text-white">
                  {opt.label}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {opt.odds.toFixed(2)}× • {Math.round(opt.totalStaked)} staked
                </Text>
              </Pressable>
            );
          })}
      </View>

      <View className="mt-3 flex-row items-center justify-between gap-2">
        <View className="flex-row gap-1">
          {STAKES.map((s) => (
            <Pressable
              key={s}
              onPress={() => setStake(s)}
              className={`rounded-full px-3 py-1 ${
                stake === s ? "bg-primary" : "bg-black/40 border border-border"
              }`}
            >
              <Text className="text-xs font-semibold text-white">${s}</Text>
            </Pressable>
          ))}
        </View>
        <Text className="text-xs text-muted-foreground">
          Balance: ${balance?.toFixed(0) ?? "—"}
        </Text>
      </View>

      <Pressable
        disabled={!selected || locked || placeBet.isPending}
        onPress={onConfirm}
        className={`mt-3 items-center rounded-2xl py-3 ${
          selected && !locked && !placeBet.isPending
            ? "bg-primary active:bg-primary/80"
            : "bg-border"
        }`}
      >
        <Text className="text-sm font-bold text-white">
          {placeBet.isPending
            ? "Placing…"
            : selected
              ? `Bet $${stake}`
              : "Pick an option"}
        </Text>
      </Pressable>
    </View>
  );
}
