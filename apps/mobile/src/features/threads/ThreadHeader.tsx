import { Platform } from "react-native";
import { ThreadSpeechSpeedMenu } from "./ThreadSpeechSpeedMenu";
import type { useThreadSpeech } from "./use-thread-speech";
import { useMemo } from "react";
import { AppBar } from "../../components/ui/AppBar";
import { ScreenHeaderButton } from "../../components/ui/ScreenHeaderButton";
import type { AppBarAction } from "../../components/ui/AppBar.types";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-content-stack";
import { useThreadHeaderOptions } from "./useThreadHeaderOptions";
import { useWorkspaceListNavigation } from "../workspace/useAndroidWorkspaceNavigation";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";

export function ThreadHeader(
  props: Parameters<typeof useThreadHeaderOptions>[0] & {
    readonly threadSpeech: ReturnType<typeof useThreadSpeech>;
    readonly hasThreadCwd: boolean;
    readonly hasWorkspaceRoot: boolean;
    readonly fileInspectorSupported: boolean;
    readonly inspectorMode: ThreadInspectorMode | null;
    readonly onToggleInspector: () => void;
    readonly onOpenGitInspector: () => void;
    readonly onOpenFilesInspector: () => void;
  },
) {
  const returnToList = useWorkspaceListNavigation("threads");
  const { layout, panes, toggleAuxiliaryPane } = useAdaptiveWorkspaceLayout();
  const { onOpenTerminal, onMergeBack } = props.gitControls;
  const native = useThreadHeaderOptions(props);
  const androidHeaderActions = useMemo<ReadonlyArray<AppBarAction>>(() => {
    const actions: AppBarAction[] = [];
    actions.push({
      accessibilityLabel: props.threadSpeech.enabled ? "Disable read aloud" : "Enable read aloud",
      icon: props.threadSpeech.enabled ? "speaker.wave.2" : "speaker.slash",
      onPress: props.threadSpeech.toggle,
      selected: props.threadSpeech.enabled,
    });
    if (props.onReturnToThread) {
      actions.push({
        accessibilityLabel: "Return to chat",
        icon: "chevron.left",
        onPress: props.onReturnToThread,
      });
    }
    if (props.hasThreadCwd) {
      const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
      actions.push({
        accessibilityLabel: filesVisible ? "Close files" : "Open files",
        selected: filesVisible,
        icon: "folder",
        onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
      });
    }
    if (props.hasWorkspaceRoot && props.gitControls.canOpenTerminal) {
      actions.push({
        accessibilityLabel: "Open terminal",
        icon: "terminal",
        onPress: () => onOpenTerminal(null),
      });
    }
    actions.push({
      accessibilityLabel: "Open git controls",
      icon: "point.topleft.down.curvedto.point.bottomright.up",
      onPress: props.onOpenGitInspector,
    });
    if (onMergeBack) {
      actions.push({
        accessibilityLabel: "Merge back to source",
        icon: PullRequestGlyph.merged,
        onPress: onMergeBack,
      });
    }
    return actions;
  }, [
    props.threadSpeech.enabled,
    props.threadSpeech.toggle,
    props.inspectorMode,
    panes.auxiliaryPaneVisible,
    props.onOpenFilesInspector,
    onOpenTerminal,
    onMergeBack,
    props.onOpenGitInspector,
    toggleAuxiliaryPane,
    props.onReturnToThread,
    props.hasThreadCwd,
    props.hasWorkspaceRoot,
    props.gitControls.canOpenTerminal,
  ]);

  return (
    <>
      <AppBar
        title={props.title}
        subtitle={props.subtitle}
        sidebar={native.sidebar}
        options={native.options}
        optionsVersion={native.optionsVersion}
        trailing={
          <>
            {Platform.OS === "android" && props.threadSpeech.enabled ? (
              <ThreadSpeechSpeedMenu
                rate={props.threadSpeech.rate}
                onChange={props.threadSpeech.setRate}
              />
            ) : null}
            {props.fileInspectorSupported && props.hasThreadCwd ? (
              <ScreenHeaderButton
                accessibilityLabel={
                  props.inspectorMode !== null && panes.auxiliaryPaneVisible
                    ? "Hide inspector"
                    : "Show inspector"
                }
                icon="sidebar.right"
                selected={props.inspectorMode !== null && panes.auxiliaryPaneVisible}
                onPress={props.onToggleInspector}
              />
            ) : null}
          </>
        }
        onBack={layout.usesSplitView ? undefined : returnToList}
        actions={androidHeaderActions}
        hideBottomBorder
      />
      {native.fallback}
    </>
  );
}
