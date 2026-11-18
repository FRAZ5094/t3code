import type { MenuAction } from "@react-native-menu/menu";
import { useGT } from "gt-react-native";
import { useMemo } from "react";
import { Platform } from "react-native";

import { ControlPill } from "../../components/ui/ControlPill";
import { Menu } from "../../components/ui/Menu";
import { THREAD_SPEECH_RATES, type ThreadSpeechRate } from "@t3tools/contracts";

export function ThreadSpeechSpeedMenu(props: {
  readonly rate: ThreadSpeechRate;
  readonly onChange: (rate: ThreadSpeechRate) => void;
}) {
  const gt = useGT();
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
    <Menu
      actions={actions}
      title={gt("Speech speed")}
      onPressAction={({ nativeEvent }) => {
        const id = nativeEvent.event;
        const value = Number(id.slice("speech-rate:".length));
        if (THREAD_SPEECH_RATES.includes(value as ThreadSpeechRate)) {
          props.onChange(value as ThreadSpeechRate);
        }
      }}
    >
      <ControlPill
        accessibilityLabel={gt("Speech speed, {rate}x", { rate: props.rate })}
        icon="textformat.size"
        label={`${props.rate}x`}
        variant="pill"
      />
    </Menu>
  );
}
