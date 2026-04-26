import React from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";

export type InputProps = TextInputProps & {
  label?: string;
  error?: string | null;
};

export function Input({ label, error, ...rest }: InputProps) {
  return (
    <View className="gap-1.5">
      {label ? (
        <Text className="text-sm font-semibold text-zinc-200">{label}</Text>
      ) : null}
      <TextInput
        placeholderTextColor="#6b7280"
        className={`min-h-[50px] rounded-2xl border px-4 text-base text-white ${
          error ? "border-red-400/80" : "border-zinc-600/80"
        } bg-zinc-900/85`}
        {...rest}
      />
      {error ? <Text className="text-xs text-red-400">{error}</Text> : null}
    </View>
  );
}
