import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { AsyncResult } from "effect/unstable/reactivity";
import { AppState, Platform } from "react-native";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  PushNotificationRegistrationInput,
  PushNotificationRegistrationResult,
} from "@t3tools/contracts";

import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { runtime } from "../../lib/runtime";
import { loadOrCreateAgentAwarenessDeviceId } from "../../persistence/imperative";
import { useAtomCommand } from "../../state/use-atom-command";
import { useRemoteConnectionStatus } from "../../state/use-remote-environment-registry";
import { registerPushNotification } from "../../connection/notifications";
import {
  requestAgentNotificationPermission,
  type NotificationPermissionResult,
} from "./notificationPermissions";

export type AndroidPushRegistrationStatus = "unknown" | "pending" | "registered" | "failed";

interface AndroidPushRegistrationContextValue {
  readonly permission: NotificationPermissionResult | null;
  readonly status: AndroidPushRegistrationStatus;
  readonly refresh: () => Promise<void>;
  readonly requestPermission: () => Promise<NotificationPermissionResult>;
}

const unsupportedPermission: NotificationPermissionResult = { type: "unsupported" };

const defaultContext: AndroidPushRegistrationContextValue = {
  permission: unsupportedPermission,
  status: "unknown",
  refresh: async () => undefined,
  requestPermission: async () => unsupportedPermission,
};

const AndroidPushRegistrationContext = createContext(defaultContext);

const ANDROID_NOTIFICATION_CHANNEL_ID = "agent-awareness";

async function configureAndroidNotificationChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNEL_ID, {
    name: "Agent awareness",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#00639B",
    enableVibrate: true,
    enableLights: true,
    showBadge: true,
  });
}

async function readNotificationPermission(): Promise<NotificationPermissionResult> {
  const permission = await Notifications.getPermissionsAsync();
  if (permission.granted) {
    return { type: "granted" };
  }
  return { type: "denied", canAskAgain: permission.canAskAgain };
}

export function AndroidPushRegistrationProvider({ children }: { readonly children: ReactNode }) {
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const register = useAtomCommand(registerPushNotification, {
    label: "mobile:notifications:register-connected-environment",
    reportFailure: false,
    reportDefect: false,
  });
  const [permission, setPermission] = useState<NotificationPermissionResult | null>(null);
  const [status, setStatus] = useState<AndroidPushRegistrationStatus>("unknown");
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const connectedEnvironmentIds = useMemo(
    () =>
      connectedEnvironments
        .filter((environment) => environment.connectionState === "connected")
        .map((environment) => environment.environmentId)
        .sort(),
    [connectedEnvironments],
  );

  const refresh = useCallback(async () => {
    if (Platform.OS !== "android") {
      return;
    }
    if (refreshInFlight.current) {
      return refreshInFlight.current;
    }

    const operation = (async () => {
      const currentPermission = await readNotificationPermission();
      setPermission(currentPermission);
      if (currentPermission.type !== "granted") {
        setStatus("unknown");
        return;
      }
      if (connectedEnvironmentIds.length === 0) {
        setStatus("unknown");
        return;
      }

      setStatus("pending");
      try {
        await configureAndroidNotificationChannel();
        const projectId =
          Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
        if (!projectId) {
          throw new Error("The EAS project ID is missing from the Android build.");
        }
        const [deviceId, expoPushToken] = await Promise.all([
          loadOrCreateAgentAwarenessDeviceId(),
          Notifications.getExpoPushTokenAsync({ projectId }),
        ]);
        const input: PushNotificationRegistrationInput = {
          deviceId,
          platform: "android",
          expoPushToken: expoPushToken.data,
          label: Device.modelName?.trim() || "Android device",
          ...(Constants.expoConfig?.android?.package
            ? { appIdentifier: Constants.expoConfig.android.package }
            : {}),
          ...(Constants.expoConfig?.version ? { appVersion: Constants.expoConfig.version } : {}),
          preferences: {
            notificationsEnabled: true,
            notifyOnApproval: true,
            notifyOnCompletion: true,
            notifyOnFailure: true,
          },
        };

        const results = await Promise.all(
          connectedEnvironmentIds.map((environmentId) =>
            register({ environmentId, input }).then((result) => {
              if (AsyncResult.isFailure(result)) {
                const error = squashAtomCommandFailure(result);
                throw error instanceof Error ? error : new Error(String(error));
              }
              return result.value as PushNotificationRegistrationResult;
            }),
          ),
        );
        if (results.length > 0) {
          setStatus("registered");
        }
      } catch (error) {
        setStatus("failed");
        throw error;
      }
    })();
    refreshInFlight.current = operation;
    try {
      await operation;
    } finally {
      refreshInFlight.current = null;
    }
  }, [connectedEnvironmentIds, register]);

  const requestPermission = useCallback(async () => {
    if (Platform.OS !== "android") {
      return unsupportedPermission;
    }
    try {
      const result = await runtime.runPromise(requestAgentNotificationPermission);
      setPermission(result);
      if (result.type === "granted") {
        await refresh();
      }
      return result;
    } catch (error) {
      setStatus("failed");
      throw error;
    }
  }, [refresh]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }
    const refreshInBackground = () => {
      void refreshRef.current().catch(() => undefined);
    };
    refreshInBackground();
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        refreshInBackground();
      }
    });
    return () => subscription.remove();
  }, [connectedEnvironmentIds.join(",")]);

  const value = useMemo(
    () => ({ permission, status, refresh, requestPermission }),
    [permission, refresh, requestPermission, status],
  );
  return (
    <AndroidPushRegistrationContext.Provider value={value}>
      {children}
    </AndroidPushRegistrationContext.Provider>
  );
}

export function useAndroidPushRegistration(): AndroidPushRegistrationContextValue {
  return useContext(AndroidPushRegistrationContext);
}
