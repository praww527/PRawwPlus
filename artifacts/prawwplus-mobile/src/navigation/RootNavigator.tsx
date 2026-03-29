import React, { useEffect } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "@/context/AuthContext";
import LoginScreen from "@/screens/LoginScreen";
import MainTabs from "@/navigation/MainTabs";
import IncomingCallScreen from "@/screens/IncomingCallScreen";
import ActiveCallScreen from "@/screens/ActiveCallScreen";
import { callKeepService } from "@/services/voip/callKeepService";
import { setupFcmListeners } from "@/services/fcmService";
import type { RootStackParamList } from "@/navigation/navigationRef";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { user, isLoading } = useAuth();

  // Set up CallKeep once on mount
  useEffect(() => {
    callKeepService.setup();
    return () => {
      callKeepService.destroy();
    };
  }, []);

  // Set up FCM foreground message listener
  useEffect(() => {
    const cleanup = setupFcmListeners();
    return cleanup;
  }, []);

  if (isLoading) return null;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!user ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : (
        <Stack.Screen name="MainTabs" component={MainTabs} />
      )}
      <Stack.Screen
        name="IncomingCall"
        component={IncomingCallScreen}
        options={{ presentation: "fullScreenModal", animation: "slide_from_bottom", gestureEnabled: false }}
      />
      <Stack.Screen
        name="ActiveCall"
        component={ActiveCallScreen}
        options={{ presentation: "fullScreenModal", animation: "slide_from_bottom", gestureEnabled: false }}
      />
    </Stack.Navigator>
  );
}
