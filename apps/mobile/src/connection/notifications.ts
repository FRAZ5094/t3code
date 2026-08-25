import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "./runtime";

export const registerPushNotification = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "mobile:notifications:register",
  tag: WS_METHODS.notificationsRegister,
  concurrency: {
    mode: "singleFlight",
    key: ({ environmentId, input }) =>
      JSON.stringify([environmentId, input.deviceId, input.expoPushToken]),
  },
});

export const unregisterPushNotification = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "mobile:notifications:unregister",
  tag: WS_METHODS.notificationsUnregister,
  concurrency: {
    mode: "singleFlight",
    key: ({ environmentId, input }) => JSON.stringify([environmentId, input.deviceId]),
  },
});
