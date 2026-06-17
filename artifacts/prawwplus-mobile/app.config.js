module.exports = ({ config }) => {
  return {
    ...config,
    android: {
      ...config.android,
      adaptiveIcon: {
        foregroundImage: "./icon.png",
        backgroundColor: "#0A84FF"
      },
    },
    // expo-build-properties and all other Expo config plugins are declared in
    // app.json plugins array (the canonical location for EAS builds).
    //
    // react-native-callkeep v4 does NOT ship an Expo config plugin (no
    // app.plugin.js in the package). It must NOT be listed in plugins.
    // ConnectionService permissions are declared in app.json android.permissions
    // and the library is linked via standard React Native autolinking.
  };
};
