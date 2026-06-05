const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.alias = {
  ...(config.resolver.alias || {}),
  "@voca/core": path.resolve(workspaceRoot, "packages/voca-core/src"),
};

module.exports = config;
