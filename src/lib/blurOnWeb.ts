import { Platform, type GestureResponderEvent } from "react-native";

/**
 * On web, react-navigation can set `aria-hidden="true"` on the screen
 * we're leaving while focus is still on the button that triggered the
 * navigation. That raises a DOM accessibility warning. Wrap any
 * navigation-triggering Pressable `onPress` with this helper so focus
 * drops before the transition.
 *
 * On native it's a no-op pass-through.
 */
export function blurOnWeb<
  T extends ((event: GestureResponderEvent) => void) | null | undefined,
>(handler: T): T {
  if (Platform.OS !== "web" || !handler) return handler;
  return ((event: GestureResponderEvent) => {
    const target = (event.currentTarget ?? event.target) as unknown as
      | { blur?: () => void }
      | null;
    target?.blur?.();
    handler(event);
  }) as T;
}
