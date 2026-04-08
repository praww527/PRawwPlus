import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/context/AuthContext";
import { CallProvider } from "@/context/CallContext";
import RootNavigator from "@/navigation/RootNavigator";
import { navigationRef } from "@/navigation/navigationRef";
import { callKeepService } from "@/services/voip/callKeepService";
import { setupFcmListeners } from "@/services/fcmService";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Initialise CallKeep once so iOS CallKit and the Android ConnectionService
  // are ready to display the native call UI whenever the app is in the
  // foreground or is resumed from the background.
  // (The killed-state path is handled in index.js via setBackgroundMessageHandler.)
  useEffect(() => {
    callKeepService.setup();

    // Wire up FCM foreground and token-refresh listeners.
    const cleanupFcm = setupFcmListeners();

    return () => {
      cleanupFcm();
      callKeepService.destroy();
    };
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <AuthProvider>
              <CallProvider>
                <NavigationContainer ref={navigationRef}>
                  <RootNavigator />
                </NavigationContainer>
              </CallProvider>
            </AuthProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
