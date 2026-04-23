import React from "react";
import { View, type ViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = ViewProps & {
  children: React.ReactNode;
  padded?: boolean;
  className?: string;
};

/**
 * Shared screen wrapper — handles the notch / status bar and gives every
 * screen the same dark background and default padding.
 */
export function Screen({ children, padded = true, className, ...rest }: Props) {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
      <View
        className={`flex-1 ${padded ? "px-4 pb-4" : ""} ${className ?? ""}`}
        {...rest}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}
