package expo.modules.t3agentnotifications

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T3AgentNotificationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3AgentNotifications")

    Function("configure") {
        deviceId: String,
        userId: String,
        scheme: String,
        ongoingEnabled: Boolean
      ->
      appContext.reactContext?.let {
        AgentNotifications.configure(it, deviceId, userId, scheme, ongoingEnabled)
      }
    }

    Function("configureDirect") { deviceId: String, scheme: String, environments: List<String>,
      notificationsEnabled: Boolean, ongoingEnabled: Boolean ->
      appContext.reactContext?.let {
        AgentNotifications.configureDirect(it, deviceId, scheme, environments, notificationsEnabled, ongoingEnabled)
      }
    }

    Function("clear") {
      appContext.reactContext?.let { AgentNotifications.clear(it) }
    }
  }
}
