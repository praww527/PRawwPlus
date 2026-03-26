import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type PropsWithChildren,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest, setToken, clearToken, getToken } from "@/lib/api";
import { registerFcmToken, removeFcmToken } from "@/lib/fcmService";
import { uploadPushToken, removePushToken, registerForPushNotificationsAsync } from "@/lib/pushNotifications";

export interface AuthUser {
  id: string;
  username: string;
  name?: string;
  isAdmin: boolean;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  pushEnabled: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  enablePush: () => Promise<boolean>;
  disablePush: () => Promise<void>;
}

const AUTH_USER_KEY = "auth_user";
const PUSH_ENABLED_KEY = "push_enabled";

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [stored, token, pushVal] = await Promise.all([
          AsyncStorage.getItem(AUTH_USER_KEY),
          getToken(),
          AsyncStorage.getItem(PUSH_ENABLED_KEY),
        ]);
        if (stored && token) {
          setUser(JSON.parse(stored));
        }
        setPushEnabled(pushVal === "true");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || "Login failed");

    await setToken(data.token);
    await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
    setUser(data.user);

    // Register FCM + Expo push tokens in background
    Promise.all([
      registerFcmToken(),
      registerForPushNotificationsAsync().then((t) => { if (t) return uploadPushToken(t); }),
    ]).then(async () => {
      await AsyncStorage.setItem(PUSH_ENABLED_KEY, "true");
      setPushEnabled(true);
    }).catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    await Promise.allSettled([removeFcmToken(), removePushToken()]);
    await apiRequest("/auth/logout", { method: "POST" }).catch(() => {});
    await Promise.all([
      clearToken(),
      AsyncStorage.removeItem(AUTH_USER_KEY),
      AsyncStorage.setItem(PUSH_ENABLED_KEY, "false"),
    ]);
    setUser(null);
    setPushEnabled(false);
  }, []);

  const enablePush = useCallback(async (): Promise<boolean> => {
    const [fcmToken, expoToken] = await Promise.all([
      registerFcmToken(),
      registerForPushNotificationsAsync(),
    ]);
    if (!fcmToken && !expoToken) return false;
    if (expoToken) await uploadPushToken(expoToken);
    await AsyncStorage.setItem(PUSH_ENABLED_KEY, "true");
    setPushEnabled(true);
    return true;
  }, []);

  const disablePush = useCallback(async () => {
    await Promise.allSettled([removeFcmToken(), removePushToken()]);
    await AsyncStorage.setItem(PUSH_ENABLED_KEY, "false");
    setPushEnabled(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, pushEnabled, login, logout, enablePush, disablePush }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
