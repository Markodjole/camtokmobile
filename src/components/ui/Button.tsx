import React from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  type PressableProps,
} from "react-native";
import { blurOnWeb } from "@/lib/blurOnWeb";

type Variant = "primary" | "secondary" | "ghost" | "destructive";

export type ButtonProps = Omit<PressableProps, "children"> & {
  label: string;
  variant?: Variant;
  loading?: boolean;
  fullWidth?: boolean;
};

const base = "flex-row items-center justify-center rounded-2xl px-5 py-3";
const sizes = "min-h-[48px]";
const variants: Record<Variant, { box: string; text: string }> = {
  primary: {
    box: "bg-blue-600 active:bg-blue-500 border border-blue-400/40",
    text: "text-white font-bold",
  },
  secondary: {
    box: "bg-zinc-800 active:bg-zinc-700 border border-zinc-600/70",
    text: "text-white font-semibold",
  },
  ghost: { box: "bg-transparent active:bg-white/5", text: "text-white font-medium" },
  destructive: {
    box: "bg-red-600 active:bg-red-500 border border-red-400/40",
    text: "text-white font-bold",
  },
};

export function Button({
  label,
  variant = "primary",
  loading,
  fullWidth,
  disabled,
  onPress,
  ...rest
}: ButtonProps) {
  const v = variants[variant];

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      className={`${base} ${sizes} ${v.box} ${fullWidth ? "w-full" : ""} ${
        disabled || loading ? "opacity-50" : ""
      }`}
      onPress={blurOnWeb(onPress)}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <Text className={v.text}>{label}</Text>
      )}
    </Pressable>
  );
}
