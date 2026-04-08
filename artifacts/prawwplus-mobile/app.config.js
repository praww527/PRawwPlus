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
      // Registers the Android ConnectionService (lock-screen / background call UI)
      // and the iOS CallKit configuration in the native build.
      // selfManaged: true — the app owns its own call audio session rather than
      // relying on the system phone app, which is required for SIP / VoIP calls.
      [
        "react-native-callkeep",
        {
          ios: {
            appName: "PRaww+",
          },
          android: {
            selfManaged: true,
          },
        },
      ],
    ],
  };
};
