import React from "react";
import { Text, View, type ViewProps } from "react-native";

export function Card({ className, ...rest }: ViewProps & { className?: string }) {
  return (
    <View
      className={`rounded-3xl border border-border bg-muted p-4 ${className ?? ""}`}
      {...rest}
    />
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text className="text-lg font-semibold text-white">{children}</Text>;
}

export function CardDescription({ children }: { children: React.ReactNode }) {
  return (
    <Text className="mt-1 text-sm text-muted-foreground">{children}</Text>
  );
}
