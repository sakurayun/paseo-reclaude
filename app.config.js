const appPkg = require("./packages/app/package.json");

module.exports = {
  expo: {
    name: "Paseo",
    slug: "paseo-reclaude",
    version: appPkg.version,
    runtimeVersion: appPkg.version,
    updates: {
      url: "https://u.expo.dev/58537a79-e9dc-4f7c-b9bf-931fb7af4647",
    },
  },
};
