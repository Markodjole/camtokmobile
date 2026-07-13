const fs = require("fs");
const path = require("path");
const {
  withDangerousMod,
  withAppBuildGradle,
  createRunOncePlugin,
} = require("expo/config-plugins");

const TFLITE_DEPS = `
    // Lead-vehicle on-device detection (COCO SSD MobileNet)
    implementation("org.tensorflow:tensorflow-lite:2.14.0")
`;

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    if (fs.statSync(from).isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function ensureModelDownloaded(projectRoot) {
  const modelPath = path.join(
    projectRoot,
    "assets/models/coco_ssd_mobilenet_v1.tflite",
  );
  if (fs.existsSync(modelPath)) return modelPath;
  // Try running download script synchronously via child_process if missing.
  try {
    require("child_process").execFileSync(
      process.execPath,
      [path.join(projectRoot, "scripts/download-lead-vehicle-model.mjs")],
      { cwd: projectRoot, stdio: "inherit" },
    );
  } catch (e) {
    console.warn(
      "[withLeadVehicleDetect] Model missing. Run: node scripts/download-lead-vehicle-model.mjs",
    );
  }
  return fs.existsSync(modelPath) ? modelPath : null;
}

function patchMainApplication(contents) {
  const pkgImport = "import com.camtok.mobile.leadvehicle.LeadVehiclePackage";
  if (!contents.includes(pkgImport)) {
    contents = contents.replace(
      "import expo.modules.ApplicationLifecycleDispatcher",
      `import expo.modules.ApplicationLifecycleDispatcher\n${pkgImport}`,
    );
  }
  // PackageList packages — add LeadVehiclePackage
  if (!contents.includes("LeadVehiclePackage()")) {
    if (contents.includes("PackageList(this).packages.apply")) {
      contents = contents.replace(
        /PackageList\(this\)\.packages\.apply\s*\{[^}]*\}/s,
        (block) => {
          if (block.includes("LeadVehiclePackage()")) return block;
          return block.replace(
            /\{/,
            "{\n              add(LeadVehiclePackage())",
          );
        },
      );
    } else if (contents.includes("PackageList(this).packages")) {
      contents = contents.replace(
        "val packages = PackageList(this).packages",
        "val packages = PackageList(this).packages.toMutableList()\n            packages.add(LeadVehiclePackage())",
      );
    }
  }
  return contents;
}

function withLeadVehicleAndroidSources(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const srcDir = path.join(projectRoot, "native/lead-vehicle/android");
      const destDir = path.join(
        platformRoot,
        "app/src/main/java/com/camtok/mobile/leadvehicle",
      );
      copyDir(srcDir, destDir);

      const modelSrc = ensureModelDownloaded(projectRoot);
      if (modelSrc) {
        const assetsDir = path.join(
          platformRoot,
          "app/src/main/assets/models",
        );
        fs.mkdirSync(assetsDir, { recursive: true });
        fs.copyFileSync(
          modelSrc,
          path.join(assetsDir, "coco_ssd_mobilenet_v1.tflite"),
        );
      }

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

function withLeadVehicleGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes("tensorflow-lite")) {
      return cfg;
    }
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /dependencies\s*\{/,
      `dependencies {\n${TFLITE_DEPS}`,
    );
    return cfg;
  });
}

function withLeadVehicleIos(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const srcDir = path.join(projectRoot, "native/lead-vehicle/ios");
      const destDir = path.join(platformRoot, "LeadVehicle");
      copyDir(srcDir, destDir);

      const modelSrc = ensureModelDownloaded(projectRoot);
      if (modelSrc) {
        const modelsDir = path.join(platformRoot, "LeadVehicleModels");
        fs.mkdirSync(modelsDir, { recursive: true });
        fs.copyFileSync(
          modelSrc,
          path.join(modelsDir, "coco_ssd_mobilenet_v1.tflite"),
        );
      }

      const xcode = require("xcode");
      const {
        getProjectName,
        addBuildSourceFileToGroup,
        addResourceFileToGroup,
      } = require("@expo/config-plugins/build/ios/utils/Xcodeproj");

      const projectName = getProjectName(projectRoot);
      const pbxPath = path.join(
        platformRoot,
        `${projectName}.xcodeproj/project.pbxproj`,
      );
      if (!fs.existsSync(pbxPath)) {
        return cfg;
      }

      const project = xcode.project(pbxPath);
      project.parseSync();

      for (const file of fs.readdirSync(destDir)) {
        if (!/\.(m|mm)$/.test(file)) continue;
        try {
          addBuildSourceFileToGroup({
            filepath: `LeadVehicle/${file}`,
            groupName: projectName,
            project,
          });
        } catch {
          // Already added on re-prebuild
        }
      }

      if (modelSrc) {
        try {
          addResourceFileToGroup({
            filepath: "LeadVehicleModels/coco_ssd_mobilenet_v1.tflite",
            groupName: projectName,
            project,
            isMediaFile: true,
          });
        } catch {
          // Already added
        }
      }

      // Header search path for LeadVehicle when compiling other groups
      const configs = project.pbxXCBuildConfigurationSection();
      for (const key of Object.keys(configs)) {
        const entry = configs[key];
        if (typeof entry !== "object" || !entry.buildSettings) continue;
        const settings = entry.buildSettings;
        const existing = settings.HEADER_SEARCH_PATHS;
        const flag = '"$(SRCROOT)/LeadVehicle"';
        if (!existing) {
          settings.HEADER_SEARCH_PATHS = ["$(inherited)", flag];
        } else if (Array.isArray(existing) && !existing.includes(flag)) {
          existing.push(flag);
        } else if (typeof existing === "string" && !existing.includes("LeadVehicle")) {
          settings.HEADER_SEARCH_PATHS = `${existing} ${flag}`;
        }
      }

      fs.writeFileSync(pbxPath, project.writeSync());
      return cfg;
    },
  ]);
}

function withLeadVehicleDetect(config) {
  config = withLeadVehicleGradle(config);
  config = withLeadVehicleAndroidSources(config);
  config = withLeadVehicleIos(config);
  return config;
}

module.exports = createRunOncePlugin(
  withLeadVehicleDetect,
  "withLeadVehicleDetect",
  "1.0.0",
);
