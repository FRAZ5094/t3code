import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const PushNotificationPlatform = Schema.Literal("android");
export type PushNotificationPlatform = typeof PushNotificationPlatform.Type;

export const PushNotificationPreferences = Schema.Struct({
  notificationsEnabled: Schema.Boolean,
  notifyOnApproval: Schema.Boolean,
  notifyOnCompletion: Schema.Boolean,
  notifyOnFailure: Schema.Boolean,
});
export type PushNotificationPreferences = typeof PushNotificationPreferences.Type;

/**
 * Registration sent by a mobile client to each environment it can reach.
 * The environment stores this locally and sends pushes directly to Expo; no
 * hosted T3 service is involved in delivery.
 */
export const PushNotificationRegistrationInput = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
  platform: PushNotificationPlatform,
  expoPushToken: TrimmedNonEmptyString,
  appIdentifier: Schema.optionalKey(TrimmedNonEmptyString),
  appVersion: Schema.optionalKey(TrimmedNonEmptyString),
  label: TrimmedNonEmptyString,
  preferences: PushNotificationPreferences,
});
export type PushNotificationRegistrationInput = typeof PushNotificationRegistrationInput.Type;

export const PushNotificationRegistrationResult = Schema.Struct({
  registered: Schema.Literal(true),
});
export type PushNotificationRegistrationResult = typeof PushNotificationRegistrationResult.Type;

export const PushNotificationUnregistrationInput = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
});
export type PushNotificationUnregistrationInput = typeof PushNotificationUnregistrationInput.Type;

export const PushNotificationOperation = Schema.Literals(["register", "unregister", "send"]);
export type PushNotificationOperation = typeof PushNotificationOperation.Type;

export class PushNotificationError extends Schema.TaggedErrorClass<PushNotificationError>()(
  "PushNotificationError",
  {
    operation: PushNotificationOperation,
    reason: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return `Push notification ${this.operation} failed: ${this.reason}`;
  }
}
