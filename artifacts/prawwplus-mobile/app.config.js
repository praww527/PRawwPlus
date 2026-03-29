module.exports = ({ config }) => {
  return {
    ...config,
    android: {
      ...config.android,
      minSdkVersion: 24,
      compileSdkVersion: 34,
      targetSdkVersion: 34,
      buildToolsVersion: "34.0.0",
    },
  };
};
