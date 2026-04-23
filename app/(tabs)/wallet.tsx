import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { Screen } from "@/components/ui/Screen";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

type WalletPayload = {
  balance: number;
  currency: string;
  ledger?: Array<{
    id: string;
    label: string;
    amount: number;
    createdAt: string;
  }>;
};

export default function WalletTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["wallet"],
    queryFn: () => apiFetch<WalletPayload>("/api/wallet"),
    // Fail softly — if the endpoint isn't there yet we render a stub.
    retry: 0,
  });

  return (
    <Screen>
      <Text className="mb-4 text-2xl font-bold text-white">Wallet</Text>

      <Card>
        <CardDescription>Available balance</CardDescription>
        <Text className="mt-1 text-4xl font-bold text-white">
          {isLoading
            ? "…"
            : error || !data
              ? "$0.00"
              : formatCurrency(data.balance, data.currency ?? "USD")}
        </Text>
      </Card>

      <View className="mt-4">
        <CardTitle>Recent activity</CardTitle>
        <View className="mt-2 gap-2">
          {(data?.ledger ?? []).length === 0 ? (
            <Text className="text-sm text-muted-foreground">No activity yet.</Text>
          ) : (
            data!.ledger!.map((l) => (
              <View
                key={l.id}
                className="flex-row items-center justify-between rounded-2xl border border-border bg-muted p-3"
              >
                <View className="flex-1">
                  <Text className="text-white">{l.label}</Text>
                  <Text className="text-xs text-muted-foreground">
                    {new Date(l.createdAt).toLocaleString()}
                  </Text>
                </View>
                <Text
                  className={`font-semibold ${
                    l.amount >= 0 ? "text-success" : "text-accent"
                  }`}
                >
                  {l.amount >= 0 ? "+" : ""}
                  {formatCurrency(l.amount)}
                </Text>
              </View>
            ))
          )}
        </View>
      </View>
    </Screen>
  );
}
