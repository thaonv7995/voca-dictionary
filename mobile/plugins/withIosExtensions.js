const fs = require("fs");
const path = require("path");
const { withXcodeProject, withEntitlementsPlist, withAppDelegate } = require("@expo/config-plugins");

function copyFolderRecursiveSync(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(target, { recursive: true });
  const files = fs.readdirSync(source);
  files.forEach((file) => {
    const curSource = path.join(source, file);
    const curTarget = path.join(target, file);
    if (fs.lstatSync(curSource).isDirectory()) {
      copyFolderRecursiveSync(curSource, curTarget);
    } else {
      fs.copyFileSync(curSource, curTarget);
    }
  });
}

const withMainAppEntitlements = (config) => {
  return withEntitlementsPlist(config, (config) => {
    config.modResults["com.apple.security.application-groups"] = [
      "group.com.voca.dictionary.mobile"
    ];
    return config;
  });
};

const withXcodeTargets = (config) => {
  return withXcodeProject(config, async (modConfig) => {
    const project = modConfig.modResults;
    const projectRoot = modConfig.modRequest.projectRoot;
    
    // Find the development team (prefer app.json config first, then fallback to Xcode search)
    let mainDevelopmentTeam = config.ios?.developmentTeam || "";
    
    if (!mainDevelopmentTeam) {
      const allConfigs = project.pbxXCBuildConfigurationSection();
      for (let key in allConfigs) {
        if (!key.endsWith("_comment")) {
          const buildConfig = allConfigs[key];
          if (buildConfig.buildSettings && buildConfig.buildSettings.DEVELOPMENT_TEAM) {
            mainDevelopmentTeam = buildConfig.buildSettings.DEVELOPMENT_TEAM;
            if (buildConfig.buildSettings.PRODUCT_NAME === '"VocaMobile"' || 
                buildConfig.buildSettings.PRODUCT_NAME === "VocaMobile") {
              break;
            }
          }
        }
      }
    }
    
    const targetsToCreate = [
      {
        name: "WidgetExtension",
        bundleId: "com.voca.dictionary.mobile.WidgetExtension",
        files: [
          "VocaWidget.swift",
          "Info.plist",
          "WidgetExtension.entitlements"
        ]
      }
    ];
    
    targetsToCreate.forEach((targetInfo) => {
      const targetName = targetInfo.name;
      const bundleId = targetInfo.bundleId;
      
      // 1. Copy template files to ios/TargetName
      const templateDir = path.join(projectRoot, "ios-templates", targetName);
      const targetDir = path.join(projectRoot, "ios", targetName);
      copyFolderRecursiveSync(templateDir, targetDir);
      
      // Check if target already exists in pbxproj
      const nativeTargets = project.pbxNativeTargetSection();
      let exists = false;
      for (let key in nativeTargets) {
        if (!key.endsWith("_comment")) {
          const target = nativeTargets[key];
          if (target.name === `"${targetName}"` || target.name === targetName) {
            exists = true;
            break;
          }
        }
      }
      
      if (!exists) {
        // 2. Add Target to pbxproj (Automatically handles CopyFiles and Target Dependencies!)
        const target = project.addTarget(targetName, "app_extension", targetName);
        
        // Add Build Phases to the new target so files added to it are compiled inside its own target scope
        project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
        project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
        project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
        
        // 3. Find the created group key
        let groupKey;
        const groups = project.hash.project.objects.PBXGroup;
        for (let key in groups) {
          if (!key.endsWith("_comment")) {
            if (groups[key].name === targetName) {
              groupKey = key;
              break;
            }
          }
        }
        
        if (!groupKey) {
          // Fallback if target group not found, use first group or create
          groupKey = project.findPBXGroupKey({ name: "CustomTemplate" }) || Object.keys(groups)[0];
        }
        
        // 4. Add files to the target group and build phases
        targetInfo.files.forEach((file) => {
          const relativePath = path.join(targetName, file);
          if (file.endsWith(".swift")) {
            project.addSourceFile(relativePath, { target: target.uuid }, groupKey);
          } else {
            // Simply reference Info.plist and entitlements in the group, no compile needed
            project.addFile(relativePath, groupKey);
          }
        });
        
        // 5. Update build configurations for targetName
        const buildConfigs = project.pbxXCBuildConfigurationSection();
        for (let key in buildConfigs) {
          if (!key.endsWith("_comment")) {
            const buildConfig = buildConfigs[key];
            if (buildConfig.buildSettings && 
                (buildConfig.buildSettings.PRODUCT_NAME === `"${targetName}"` || 
                 buildConfig.buildSettings.PRODUCT_NAME === targetName)) {
              buildConfig.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${bundleId}"`;
              buildConfig.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '"17.0"';
              buildConfig.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
              buildConfig.buildSettings.SWIFT_VERSION = '"5.0"';
              buildConfig.buildSettings.CODE_SIGN_ENTITLEMENTS = `"${targetName}/${targetName}.entitlements"`;
              buildConfig.buildSettings.INFOPLIST_FILE = `"${targetName}/Info.plist"`;
              buildConfig.buildSettings.LD_RUNPATH_SEARCH_PATHS = '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"';
              buildConfig.buildSettings.SKIP_INSTALL = 'YES';
              
              // Apply code signing settings automatically
              buildConfig.buildSettings.CODE_SIGN_STYLE = '"Automatic"';
              if (mainDevelopmentTeam) {
                buildConfig.buildSettings.DEVELOPMENT_TEAM = mainDevelopmentTeam;
              }
              
              // App Intents specific compilation fixes
              if (targetName === "WidgetExtension") {
                buildConfig.buildSettings.ENABLE_APPSHORTCUTS_FLEXIBLE_MATCHING = 'NO';
                buildConfig.buildSettings.ENABLE_APPINTENTS_DEPLOYMENT_AWARE_PROCESSING = 'NO';
              }
            }
          }
        }
      }
    });
    
    return modConfig;
  });
};

const { withDangerousMod } = require("@expo/config-plugins");

const withPodfileWarningsInhibited = (config) => {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const podfilePath = path.join(config.modRequest.projectRoot, "ios", "Podfile");
      if (fs.existsSync(podfilePath)) {
        let content = fs.readFileSync(podfilePath, "utf8");
        if (!content.includes("inhibit_all_warnings!")) {
          content = content.replace(/(platform\s+:ios,.*)/, "$1\ninhibit_all_warnings!");
          fs.writeFileSync(podfilePath, content, "utf8");
        }
      }
      return config;
    }
  ]);
};

const withSpotlightAppDelegate = (config) => {
  return withAppDelegate(config, (config) => {
    let contents = config.modResults.contents;
    
    // 1. Inject import CoreSpotlight if missing
    if (!contents.includes("import CoreSpotlight")) {
      contents = contents.replace(
        /import Expo/,
        "import CoreSpotlight\nimport Expo"
      );
    }
    
    // 2. Intercept Spotlight tap action inside continue userActivity callback
    const spotlightCheck = `if userActivity.activityType == CSSearchableItemActionType,
       let uniqueIdentifier = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String {
        if let url = URL(string: "voca-mobile://cards/\\(uniqueIdentifier)") {
            return RCTLinkingManager.application(application, open: url, options: [:])
        }
    }`;
    
    const targetString = "let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)";
    if (contents.includes(targetString) && !contents.includes("CSSearchableItemActionType")) {
      contents = contents.replace(
        targetString,
        `${spotlightCheck.replace(/\n/g, "\n    ")}\n    ${targetString}`
      );
    }

    // 3. Inject performActionFor shortcutItem override
    if (!contents.includes("performActionFor shortcutItem")) {
      const shortcutMethods = `

  public override func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    let handled = handleShortcutItem(shortcutItem)
    completionHandler(handled)
  }

  private func handleShortcutItem(_ shortcutItem: UIApplicationShortcutItem) -> Bool {
    if shortcutItem.type == "com.voca.action.addWord" {
      if let url = URL(string: "voca-mobile://add-word") {
        return RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
      }
    }
    return false
  }
`;

      contents = contents.replace(
        /(\n\}\s*class ReactNativeDelegate:)/,
        (match) => `${shortcutMethods.trimEnd()}${match}`
      );
    }
    
    config.modResults.contents = contents;
    return config;
  });
};

module.exports = function withIosExtensionsPlugin(config) {
  config = withMainAppEntitlements(config);
  config = withXcodeTargets(config);
  config = withSpotlightAppDelegate(config);
  config = withPodfileWarningsInhibited(config);
  return config;
};
