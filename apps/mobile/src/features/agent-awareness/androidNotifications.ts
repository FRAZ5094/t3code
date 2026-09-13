import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

interface AndroidAgentNotifications {
  configureDirect(
    deviceId: string,
    scheme: string,
    environments: string[],
    notificationsEnabled: boolean,
    ongoingEnabled: boolean,
  ): void;
  configure(deviceId: string, userId: string, scheme: string, ongoingEnabled: boolean): void;
  clear(): void;
}

const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<AndroidAgentNotifications>("T3AgentNotifications")
    : null;

export function supportsAndroidAgentNotifications(): boolean {
  return typeof native?.configure === "function" && typeof native?.clear === "function";
}

export function configureAndroidAgentNotifications(
  deviceId: string,
  userId: string,
  ongoingEnabled: boolean,
): void {
  const scheme = Constants.expoConfig?.scheme;
  native?.configure?.(
    deviceId,
    userId,
    (Array.isArray(scheme) ? scheme[0] : scheme) ?? "t3code",
    ongoingEnabled,
  );
}

export function clearAndroidAgentNotifications(): void {
  native?.clear?.();
}

export function supportsDirectAndroidNotifications(): boolean {
  return typeof native?.configureDirect === "function";
}
export function configureDirectAndroidNotifications(
  deviceId: string,
  environments: string[],
  preferences: { notificationsEnabled: boolean; liveActivitiesEnabled: boolean },
): void {
  const scheme = Constants.expoConfig?.scheme;
  native?.configureDirect(
    deviceId,
    (Array.isArray(scheme) ? scheme[0] : scheme) ?? "t3code",
    environments,
    preferences.notificationsEnabled,
    preferences.liveActivitiesEnabled,
  );
}
