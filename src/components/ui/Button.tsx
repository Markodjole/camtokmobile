import React from "react";
import { ActivityIndicator, Pressable, Text, type PressableProps } from "react-native";

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
  primary: { box: "bg-primary active:bg-primary/80", text: "text-white font-semibold" },
  secondary: { box: "bg-muted active:bg-muted/70 border border-border", text: "text-white font-medium" },
  ghost: { box: "bg-transparent active:bg-white/5", text: "text-white font-medium" },
  destructive: { box: "bg-accent active:bg-accent/80", text: "text-white font-semibold" },
};

export function Button({
  label,
  variant = "primary",
  loading,
  fullWidth,
  disabled,
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
