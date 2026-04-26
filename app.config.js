// Dynamic Expo config: extends app.json so we can inject secrets from env
// (Google Maps Android API key) without committing the value to source control.
const baseConfig = require("./app.json").expo;

const GOOGLE_MAPS_ANDROID_API_KEY =
  process.env.GOOGLE_MAPS_ANDROID_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ||
  null;

module.exports = ({ config }) => {
  const merged = { ...baseConfig, ...config };

  return {
    ...merged,
    android: {
      ...(baseConfig.android ?? {}),
      ...(config.android ?? {}),
      config: {
        ...(baseConfig.android?.config ?? {}),
        ...(config.android?.config ?? {}),
        ...(GOOGLE_MAPS_ANDROID_API_KEY
          ? { googleMaps: { apiKey: GOOGLE_MAPS_ANDROID_API_KEY } }
          : {}),
      },
    },
  };
};
