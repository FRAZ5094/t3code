import Constants from "expo-constants";
import { Platform } from "react-native";

export function supportsAgentAwarenessPush() {
  return (
    Platform.OS === "android" ||
    (Platform.OS === "ios" && Constants.expoConfig?.extra?.iosPersonalTeamBuild !== true)
  );
}
