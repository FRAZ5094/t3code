import { memo } from "react";
import { Volume2Icon } from "lucide-react";
import { useSettings } from "~/hooks/useSettings";
import { applySpeechPlaybackRate, hasSpeechSynthesisSupport } from "~/lib/speechSynthesis";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const TEST_PHRASE = "Speech test.";

export const SpeechTestButton = memo(function SpeechTestButton() {
  const speechPlaybackRate = useSettings((settings) => settings.speechPlaybackRate);
  const speechSynthesisAvailable = hasSpeechSynthesisSupport();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            className="shrink-0"
            aria-label="Speak test phrase"
            variant="outline"
            size="xs"
            disabled={!speechSynthesisAvailable}
            onClick={() => {
              if (!hasSpeechSynthesisSupport()) {
                return;
              }

              const utterance = new SpeechSynthesisUtterance(TEST_PHRASE);
              applySpeechPlaybackRate(utterance, speechPlaybackRate);
              window.speechSynthesis.speak(utterance);
            }}
          >
            <Volume2Icon className="size-3" />
          </Button>
        }
      />
      <TooltipPopup side="bottom">
        {speechSynthesisAvailable ? "Speak test phrase" : "Speech synthesis is unavailable"}
      </TooltipPopup>
    </Tooltip>
  );
});
