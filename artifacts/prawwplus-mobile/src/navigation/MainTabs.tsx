import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { BottomTabNavigationOptions } from "@react-navigation/bottom-tabs";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import DialpadScreen from "@/screens/DialpadScreen";
import RecentsScreen from "@/screens/RecentsScreen";
import ContactsScreen from "@/screens/ContactsScreen";
import VoicemailScreen from "@/screens/VoicemailScreen";
import SettingsScreen from "@/screens/SettingsScreen";
import { useCall } from "@/context/CallContext";

export type MainTabParamList = {
  Dialpad:   undefined;
  Recents:   undefined;
  Contacts:  undefined;
  Voicemail: undefined;
  Settings:  undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

const ICON_MAP: Record<keyof MainTabParamList, string> = {
  Dialpad:   "grid",
  Recents:   "clock",
  Contacts:  "users",
  Voicemail: "voicemail",
  Settings:  "settings",
};

export default function MainTabs() {
  const { missedBadgeCount } = useCall();

  return (
    <Tab.Navigator
      screenOptions={({ route }: { route: RouteProp<MainTabParamList, keyof MainTabParamList> }): BottomTabNavigationOptions => ({
        headerShown: false,
        tabBarStyle: { backgroundColor: "#0A0A0A", borderTopColor: "#141414" },
        tabBarActiveTintColor: "#0A84FF",
        tabBarInactiveTintColor: "#666",
        tabBarBadge:
          route.name === "Recents" && missedBadgeCount > 0 ? missedBadgeCount : undefined,
        tabBarBadgeStyle: {
          backgroundColor: "#FF3B30",
          color: "#fff",
          fontSize: 11,
          fontWeight: "700",
        },
        tabBarIcon: ({ color, size }: { color: string; size: number }) => (
          <Feather name={ICON_MAP[route.name as keyof MainTabParamList] as any} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Dialpad"   component={DialpadScreen} />
      <Tab.Screen name="Recents"   component={RecentsScreen} />
      <Tab.Screen name="Contacts"  component={ContactsScreen} />
      <Tab.Screen name="Voicemail" component={VoicemailScreen} />
      <Tab.Screen name="Settings"  component={SettingsScreen} />
    </Tab.Navigator>
  );
}
