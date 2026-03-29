import { createNavigationContainerRef } from "@react-navigation/native";

export type RootStackParamList = {
  Login: undefined;
  MainTabs: undefined;
  IncomingCall: undefined;
  ActiveCall: undefined;
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigate<RouteName extends keyof RootStackParamList>(
  name: RouteName,
  params?: RootStackParamList[RouteName],
) {
  if (navigationRef.isReady()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    navigationRef.navigate(name as any, params as any);
  }
}

export function resetTo(routeName: keyof RootStackParamList) {
  if (!navigationRef.isReady()) return;
  navigationRef.reset({
    index: 0,
    routes: [{ name: routeName }],
  });
}
