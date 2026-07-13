const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
  withDangerousMod,
  createRunOncePlugin,
} = require("expo/config-plugins");

/**
 * Boost CamTok in the Android share sheet when sharing Maps links/text:
 * - high priority on SEND intent-filters
 * - clear share label ("CamTok destination")
 * - static share-target shortcut (direct-share row)
 *
 * Note: Android still ranks by usage; riders should also Pin CamTok once.
 */
function bumpSendFilters(androidManifest) {
  const app = androidManifest.manifest.application?.[0];
  if (!app) return androidManifest;

  const activities = app.activity ?? [];
  for (const activity of activities) {
    const filters = activity["intent-filter"];
    if (!Array.isArray(filters)) continue;

    for (const filter of filters) {
      const actions = filter.action ?? [];
      const isSend = actions.some(
        (a) =>
          a.$?.["android:name"] === "android.intent.action.SEND" ||
          a.$?.["android:name"] === "android.intent.action.SEND_MULTIPLE",
      );
      if (!isSend) continue;

      filter.$ = filter.$ ?? {};
      filter.$["android:priority"] = "999";
      // Shown as the row label in some share UIs
      filter.$["android:label"] = "CamTok destination";
    }
  }

  // Ensure MainActivity declares shortcuts meta-data
  const main =
    activities.find(
      (a) => a.$?.["android:name"] === ".MainActivity",
    ) ?? activities[0];
  if (main) {
    main["meta-data"] = main["meta-data"] ?? [];
    const hasShortcuts = main["meta-data"].some(
      (m) => m.$?.["android:name"] === "android.app.shortcuts",
    );
    if (!hasShortcuts) {
      main["meta-data"].push({
        $: {
          "android:name": "android.app.shortcuts",
          "android:resource": "@xml/camtok_share_shortcuts",
        },
      });
    }
  }

  return androidManifest;
}

function withShareSheetBoostManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = bumpSendFilters(cfg.modResults);
    return cfg;
  });
}

function withShareSheetBoostXml(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const resXml = path.join(
        cfg.modRequest.platformProjectRoot,
        "app/src/main/res/xml",
      );
      fs.mkdirSync(resXml, { recursive: true });
      const shortcutsPath = path.join(resXml, "camtok_share_shortcuts.xml");
      fs.writeFileSync(
        shortcutsPath,
        `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <share-target android:targetClass="com.camtok.mobile.MainActivity">
    <data android:mimeType="text/*" />
    <category android:name="com.camtok.mobile.category.DESTINATION_SHARE" />
  </share-target>
</shortcuts>
`,
      );
      return cfg;
    },
  ]);
}

function withShareSheetBoost(config) {
  config = withShareSheetBoostManifest(config);
  config = withShareSheetBoostXml(config);
  return config;
}

module.exports = createRunOncePlugin(
  withShareSheetBoost,
  "with-camtok-share-sheet-boost",
  "1.0.0",
);
