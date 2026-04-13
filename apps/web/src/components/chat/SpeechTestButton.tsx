import { memo } from "react";
import { Volume2Icon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const TEST_PHRASE = "Speech test.";

function hasSpeechSynthesisSupport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis?.speak === "function" &&
    typeof SpeechSynthesisUtterance === "function"
  );
}

export const SpeechTestButton = memo(function SpeechTestButton() {
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
