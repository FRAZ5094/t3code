import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useAtomValue, useAtomSet } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { AppState, Platform } from "react-native";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useState,
} from "react";
import type { EnvironmentId, PushNotificationPreferences } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { runtime } from "../../lib/runtime";
import { loadOrCreateAgentAwarenessDeviceId } from "../../persistence/imperative";
import { useAtomCommand } from "../../state/use-atom-command";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import {
  useRemoteConnectionStatus,
  useSavedRemoteConnections,
} from "../../state/use-remote-environment-registry";
import { registerPushNotification } from "../../connection/notifications";
import {
  configureDirectAndroidNotifications,
  supportsDirectAndroidNotifications,
} from "./androidNotifications";
import { requestAgentNotificationPermission } from "./notificationPermissions";

const defaults: PushNotificationPreferences = {
  notificationsEnabled: true,
  liveActivitiesEnabled: true,
  notifyOnApproval: true,
  notifyOnInput: true,
  notifyOnCompletion: true,
  notifyOnFailure: true,
};
const AndroidPushRegistrationContext = createContext({
  preferences: defaults,
  status: "unknown" as "unknown" | "pending" | "registered" | "failed",
  error: null as string | null,
  supported: false,
  permissionGranted: false,
  update: async (_patch: Partial<PushNotificationPreferences>) => {},
  refresh: async () => {},
});

export function AndroidPushRegistrationProvider({ children }: { readonly children: ReactNode }) {
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const { savedConnectionsById, isLoadingSavedConnection } = useSavedRemoteConnections();
  const stored = useAtomValue(mobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(stored)
    ? (stored.value.directPushPreferences ?? defaults)
    : defaults;
  const save = useAtomSet(updateMobilePreferencesAtom, { mode: "promise" });
  const register = useAtomCommand(registerPushNotification, {
    label: "mobile:notifications:register",
    reportFailure: false,
    reportDefect: false,
  });
  const [status, setStatus] = useState<"unknown" | "pending" | "registered" | "failed">("unknown");
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = Platform.OS === "android" && supportsDirectAndroidNotifications();
  const connectedIdsKey = JSON.stringify(
    connectedEnvironments
      .filter((environment) => environment.connectionState === "connected")
      .map((environment) => environment.environmentId)
      .sort(),
  );
  const savedIdsKey = JSON.stringify(Object.keys(savedConnectionsById).sort());
  const connectedIds = useMemo(
    () => JSON.parse(connectedIdsKey) as EnvironmentId[],
    [connectedIdsKey],
  );
  const savedIds = useMemo(() => JSON.parse(savedIdsKey) as string[], [savedIdsKey]);
  const ready = AsyncResult.isSuccess(stored) && !isLoadingSavedConnection;
  const current = useRef({ preferences, connectedIds, savedIds, ready: false });
  const pending = useRef(Promise.resolve());
  const lastToken = useRef<string | null>(null);
  const refresh = useCallback(() => {
    // Serialize refreshes; read the latest preferences after an earlier registration settles.
    const operation = pending.current
      .catch(() => {})
      .then(async () => {
        if (!supported || !current.current.ready) return;
        const deviceId = await loadOrCreateAgentAwarenessDeviceId();
        const permission = await Notifications.getPermissionsAsync();
        const { preferences, connectedIds, savedIds } = current.current;
        setPermissionGranted(permission.granted);
        const effective = {
          ...preferences,
          notificationsEnabled: preferences.notificationsEnabled && permission.granted,
          liveActivitiesEnabled: preferences.liveActivitiesEnabled && permission.granted,
        };
        configureDirectAndroidNotifications(deviceId, savedIds, effective);
        if (connectedIds.length === 0 || !permission.granted) {
          setStatus("unknown");
          return;
        }
        setStatus("pending");
        setError(null);
        const token = await Notifications.getDevicePushTokenAsync();
        if (token.type !== "android" || typeof token.data !== "string")
          throw new Error("No Android push token is available.");
        lastToken.current = token.data;
        for (const environmentId of connectedIds) {
          const result = await register({
            environmentId: environmentId as EnvironmentId,
            input: {
              deviceId,
              platform: "android",
              fcmToken: token.data,
              label: Device.modelName?.trim() || "Android device",
              appIdentifier: Constants.expoConfig?.android?.package,
              preferences: effective,
            },
          });
          if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
        }
        setStatus("registered");
      });
    pending.current = operation.catch((error: unknown) => {
      setStatus("failed");
      setError(error instanceof Error ? error.message : String(error));
    });
    return pending.current;
  }, [register, supported]);
  const update = useCallback(
    async (patch: Partial<PushNotificationPreferences>) => {
      if (patch.notificationsEnabled || patch.liveActivitiesEnabled) {
        const result = await runtime.runPromise(requestAgentNotificationPermission);
        if (result.type !== "granted")
          throw new Error("Allow notifications in Android Settings to enable agent notifications.");
      }
      const next = { ...current.current.preferences, ...patch };
      await save({ directPushPreferences: next });
      current.current.preferences = next;
      await refresh();
    },
    [refresh, save],
  );
  useEffect(() => {
    current.current = { preferences, connectedIds, savedIds, ready };
    void refresh();
  }, [preferences, connectedIds, savedIds, ready, refresh]);
  useEffect(() => {
    if (!supported) return;
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    const token = Notifications.addPushTokenListener((token) => {
      // Expo also emits the current token when getDevicePushTokenAsync resolves.
      // Only token rotation should trigger another registration.
      if (
        token.type !== "android" ||
        typeof token.data !== "string" ||
        token.data === lastToken.current
      )
        return;
      lastToken.current = token.data;
      void refresh();
    });
    return () => {
      app.remove();
      token.remove();
    };
  }, [supported, refresh]);
  const value = useMemo(
    () => ({ preferences, status, error, supported, permissionGranted, update, refresh }),
    [preferences, status, error, supported, permissionGranted, update, refresh],
  );
  return (
    <AndroidPushRegistrationContext.Provider value={value}>
      {children}
    </AndroidPushRegistrationContext.Provider>
  );
}
export function useAndroidPushRegistration() {
  return useContext(AndroidPushRegistrationContext);
}
