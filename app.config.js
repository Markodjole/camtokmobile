// Dynamic Expo config: extends app.json so we can inject secrets from env
// (Google Maps API key) without committing the value to source control.
const baseConfig = require("./app.json").expo;

const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_MAPS_ANDROID_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  null;

module.exports = ({ config } = {}) => {
  const incoming = config ?? {};

  return {
    ...baseConfig,
    ...incoming,
    ios: {
      ...(baseConfig.ios ?? {}),
      ...(incoming.ios ?? {}),
      config: {
        ...(baseConfig.ios?.config ?? {}),
        ...(incoming.ios?.config ?? {}),
        ...(GOOGLE_MAPS_API_KEY
          ? { googleMapsApiKey: GOOGLE_MAPS_API_KEY }
          : {}),
      },
    },
    android: {
      ...(baseConfig.android ?? {}),
      ...(incoming.android ?? {}),
      config: {
        ...(baseConfig.android?.config ?? {}),
        ...(incoming.android?.config ?? {}),
        ...(GOOGLE_MAPS_API_KEY
          ? { googleMaps: { apiKey: GOOGLE_MAPS_API_KEY } }
          : {}),
      },
    },
  };
};
