module.exports = ({ config }) => {
  return {
    ...config,
    android: {
      ...config.android,
      minSdkVersion: 24,
      compileSdkVersion: 34,
      targetSdkVersion: 34,
      buildToolsVersion: "34.0.0",
      adaptiveIcon: {
        foregroundImage: "./icon.png",
        backgroundColor: "#0A84FF"
      },
    },
    plugins: [
      ...(config.plugins || []),
      [
        "expo-build-properties",
        {
          android: {
            minSdkVersion: 24,
            compileSdkVersion: 34,
            targetSdkVersion: 34,
            buildToolsVersion: "34.0.0",
            enableProguardInReleaseBuilds: false,
            enableShrinkResourcesInReleaseBuilds: false,
          },
        },
      ],
    ],
  };
};
