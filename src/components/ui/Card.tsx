import React from "react";
import { Text, View, type ViewProps } from "react-native";

export function Card({ className, ...rest }: ViewProps & { className?: string }) {
  return (
    <View
      className={`rounded-3xl border border-white/10 bg-zinc-900/85 p-4 ${className ?? ""}`}
      {...rest}
    />
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text className="text-lg font-bold tracking-tight text-white">{children}</Text>;
}

export function CardDescription({ children }: { children: React.ReactNode }) {
  return <Text className="mt-1 text-sm leading-5 text-zinc-400">{children}</Text>;
}
