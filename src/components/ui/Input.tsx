import React from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";

export type InputProps = TextInputProps & {
  label?: string;
  error?: string | null;
};

export function Input({ label, error, ...rest }: InputProps) {
  return (
    <View className="gap-1">
      {label ? (
        <Text className="text-sm font-medium text-white/80">{label}</Text>
      ) : null}
      <TextInput
        placeholderTextColor="#71717a"
        className={`min-h-[48px] rounded-2xl border px-4 text-base text-white ${
          error ? "border-accent" : "border-border"
        } bg-muted`}
        {...rest}
      />
      {error ? <Text className="text-xs text-accent">{error}</Text> : null}
    </View>
  );
}
