import { memo } from "react";
import { Volume2Icon } from "lucide-react";

import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const AutoReadRepliesToggle = memo(function AutoReadRepliesToggle() {
  const autoReadReplies = useSettings((settings) => settings.autoReadReplies);
  const { updateSettings } = useUpdateSettings();
  const speechSynthesisAvailable =
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof SpeechSynthesisUtterance !== "undefined";
  const tooltipText = `${autoReadReplies ? "Auto-read replies is on" : "Auto-read replies is off"}${
    speechSynthesisAvailable ? "" : " Speech synthesis is unavailable in this browser"
  }`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0"
            pressed={autoReadReplies}
            onPressedChange={(pressed) => {
              updateSettings({ autoReadReplies: pressed });
            }}
            aria-label="Auto-read replies"
            variant="outline"
            size="xs"
          >
            <Volume2Icon className="size-3" />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{tooltipText}</TooltipPopup>
    </Tooltip>
  );
});
