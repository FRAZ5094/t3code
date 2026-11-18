import { useGT, useMessages } from "gt-react-native";
import { Platform } from "react-native";

import { AppBar } from "../../components/ui/AppBar";
import type { AppBarAction, AppBarMenu } from "../../components/ui/AppBar.types";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-navigation";
import { useWorkspaceBackNavigation } from "../layout/workspace/useAndroidWorkspaceNavigation";
import {
  threadTerminalMenu,
  useThreadGitMenuDefinition,
  type ThreadGitControlsProps,
} from "./ThreadGitControls";
import { ThreadSpeechSpeedMenu } from "./ThreadSpeechSpeedMenu";
import type { useThreadSpeech } from "./use-thread-speech";

export function ThreadHeader(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly gitControls: ThreadGitControlsProps;
  readonly onReturnToThread?: () => void;
  readonly draft?: boolean;
  readonly hasThreadCwd: boolean;
  readonly inspectorMode: ThreadInspectorMode | null;
  readonly onOpenFilesInspector: () => void;
  readonly threadSpeech?: ReturnType<typeof useThreadSpeech>;
}) {
  const gt = useGT();
  const m = useMessages();
  const goBack = useWorkspaceBackNavigation();
  const { toggleAuxiliaryPane, startNewTask } = useAdaptiveWorkspaceLayout();
  const { panes } = useWorkspacePaneState();
  const gitMenu = useThreadGitMenuDefinition(props.gitControls);
  const terminalMenu = threadTerminalMenu(props.gitControls, m);
  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
  const speech = Platform.OS === "android" ? props.threadSpeech : undefined;
  const actions: AppBarAction[] = [
    ...(speech
      ? [
          {
            accessibilityLabel: speech.enabled ? gt("Disable read aloud") : gt("Enable read aloud"),
            icon: speech.enabled ? "speaker.wave.2" : "speaker.slash",
            selected: speech.enabled,
            onPress: speech.toggle,
          } satisfies AppBarAction,
        ]
      : []),
    ...(props.hasThreadCwd
      ? [
          {
            accessibilityLabel: filesVisible ? gt("Close files") : gt("Open files"),
            icon: "folder",
            selected: filesVisible,
            disabled: !props.gitControls.canOpenFiles,
            separateBackground: false,
            onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
          } satisfies AppBarAction,
        ]
      : []),
  ];
  const menus = [gitMenu, terminalMenu].filter((menu): menu is AppBarMenu => menu !== null);

  return (
    <AppBar
      title={props.title}
      subtitle={props.subtitle}
      onBackToList={goBack}
      onCompose={props.draft ? undefined : startNewTask}
      backInSplitView={
        props.onReturnToThread
          ? {
              accessibilityLabel: gt("Return to chat"),
              icon: "chevron.left",
              onPress: props.onReturnToThread,
            }
          : undefined
      }
      actions={actions}
      menus={menus}
      trailing={
        speech?.enabled ? (
          <ThreadSpeechSpeedMenu rate={speech.rate} onChange={speech.setRate} />
        ) : undefined
      }
      hideBottomBorder
    />
  );
}
