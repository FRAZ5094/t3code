import type { MenuAction } from "@react-native-menu/menu";
import { useMemo } from "react";
import { Platform } from "react-native";

import { ControlPill, ControlPillMenu } from "../../components/ControlPill";
import { THREAD_SPEECH_RATES, type ThreadSpeechRate } from "./threadSpeech";

export function ThreadSpeechSpeedMenu(props: {
  readonly rate: ThreadSpeechRate;
  readonly onChange: (rate: ThreadSpeechRate) => void;
}) {
  const actions = useMemo<MenuAction[]>(
    () =>
      THREAD_SPEECH_RATES.map((rate) => ({
        id: `speech-rate:${rate}`,
        title: `${rate}x`,
        state: rate === props.rate ? ("on" as const) : undefined,
      })),
    [props.rate],
  );

  if (Platform.OS !== "android") {
    return null;
  }

  return (
    <ControlPillMenu
      actions={actions}
      title="Speech speed"
      onPressAction={(event) => {
        const id = event.nativeEvent.event;
        const value = Number(id.slice("speech-rate:".length));
        if (THREAD_SPEECH_RATES.includes(value as ThreadSpeechRate)) {
          props.onChange(value as ThreadSpeechRate);
        }
      }}
    >
      <ControlPill
        accessibilityLabel={`Speech speed, ${props.rate}x`}
        icon="textformat.size"
        label={`${props.rate}x`}
        variant="pill"
      />
    </ControlPillMenu>
  );
}
