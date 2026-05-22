import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { apiRequest } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotificationsAsync(): Promise<
  string | null
> {
  if (Platform.OS === "web") return null;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("calls", {
      name: "Calls",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#0A84FF",
      sound: "default",
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  return tokenData.data;
}

export async function uploadPushToken(token: string): Promise<void> {
  try {
    await apiRequest("/users/push-token", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  } catch {
    // Silently fail — token will be re-registered on next login
  }
}

export async function removePushToken(): Promise<void> {
  try {
    await apiRequest("/users/push-token", { method: "DELETE" });
  } catch {
    // Silently fail
  }
}

export function formatNotificationPayload(
  data: Record<string, string>,
): { title: string; body: string } | null {
  if (data.type === "incoming_call") {
    return {
      title: "Incoming Call",
      body: `Extension ${data.fromExtension} is calling`,
    };
  }
  if (data.type === "missed_call") {
    return {
      title: "Missed Call",
      body: `You missed a call from extension ${data.fromExtension}`,
    };
  }
  if (data.type === "call_terminated") {
    return {
      title: "Call Ended",
      body: data.body ?? "Your call was ended by an administrator.",
    };
  }
  if (data.type === "admin_message" || data.type === "update" || data.type === "maintenance") {
    return {
      title: data.title ?? "PRaww+",
      body:  data.body  ?? "",
    };
  }
  // Generic fallback: if the data has title+body, show it
  if (data.title && data.body) {
    return { title: data.title, body: data.body };
  }
  return null;
}
