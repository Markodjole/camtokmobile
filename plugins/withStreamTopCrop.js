const fs = require("fs");
const path = require("path");
const {
  withDangerousMod,
  createRunOncePlugin,
} = require("expo/config-plugins");

const ANDROID_PKG = "com.camtok.mobile.streamcrop";
const ANDROID_IMPORT = `import ${ANDROID_PKG}.StreamTopCropRegistration`;

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, name), path.join(dest, name));
  }
}

function patchMainApplication(contents) {
  if (contents.includes("StreamTopCropRegistration")) {
    return contents;
  }
  if (!contents.includes(ANDROID_IMPORT)) {
    contents = contents.replace(
      "import expo.modules.ApplicationLifecycleDispatcher",
      `import expo.modules.ApplicationLifecycleDispatcher\n${ANDROID_IMPORT}`,
    );
  }
  return contents.replace(
    "loadReactNative(this)",
    "StreamTopCropRegistration.register()\n    loadReactNative(this)",
  );
}

function withStreamTopCropAndroid(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const srcDir = path.join(projectRoot, "native/stream-top-crop/android");
      const destDir = path.join(
        platformRoot,
        "app/src/main/java/com/camtok/mobile/streamcrop",
      );

      copyDir(srcDir, destDir);

      const mainAppPath = path.join(
        platformRoot,
        "app/src/main/java/com/camtok/mobile/MainApplication.kt",
      );
      if (fs.existsSync(mainAppPath)) {
        const next = patchMainApplication(fs.readFileSync(mainAppPath, "utf8"));
        fs.writeFileSync(mainAppPath, next);
      }

      return cfg;
    },
  ]);
}

function withStreamTopCropIos(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const srcDir = path.join(projectRoot, "native/stream-top-crop/ios");
      const destDir = path.join(platformRoot, "StreamTopCrop");
      copyDir(srcDir, destDir);

      const xcode = require("xcode");
      const { getProjectName } = require("@expo/config-plugins/build/ios/utils/Xcodeproj");
      const { addBuildSourceFileToGroup } = require(
        "@expo/config-plugins/build/ios/utils/Xcodeproj",
      );

      const projectName = getProjectName(projectRoot);
      const pbxPath = path.join(platformRoot, `${projectName}.xcodeproj/project.pbxproj`);
      if (!fs.existsSync(pbxPath)) {
        return cfg;
      }

      const project = xcode.project(pbxPath);
      project.parseSync();

      for (const file of fs.readdirSync(destDir)) {
        if (!/\.(m|mm)$/.test(file)) continue;
        addBuildSourceFileToGroup({
          filepath: `StreamTopCrop/${file}`,
          groupName: projectName,
          project,
        });
      }

      fs.writeFileSync(pbxPath, project.writeSync());

      return cfg;
    },
  ]);
}

function withStreamTopCrop(config) {
  config = withStreamTopCropAndroid(config);
  config = withStreamTopCropIos(config);
  return config;
}

module.exports = createRunOncePlugin(withStreamTopCrop, "withStreamTopCrop", "1.0.0");
