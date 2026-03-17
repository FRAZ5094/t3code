import { type ProviderKind, type ProviderReasoningEffort } from "@t3tools/contracts";
import { getDefaultReasoningEffort } from "@t3tools/shared/model";
import { memo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";

function effortLabel(provider: ProviderKind, effort: ProviderReasoningEffort): string {
  if (provider === "codex") {
    const codexLabels: Record<string, string> = {
      low: "Low",
      medium: "Medium",
      high: "High",
      xhigh: "Extra High",
    };
    return codexLabels[effort] ?? effort;
  }

  const claudeLabels: Record<string, string> = {
    low: "Low",
    medium: "Medium",
    high: "High",
    max: "Max",
    ultrathink: "Ultrathink",
  };
  return claudeLabels[effort] ?? effort;
}

export const ProviderTraitsPicker = memo(function ProviderTraitsPicker(props: {
  provider: ProviderKind;
  effort: ProviderReasoningEffort;
  supportsFastMode?: boolean;
  fastModeEnabled?: boolean;
  options: ReadonlyArray<ProviderReasoningEffort>;
  onEffortChange: (effort: ProviderReasoningEffort) => void;
  onFastModeChange?: (enabled: boolean) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const defaultReasoningEffort = getDefaultReasoningEffort(props.provider);
  const triggerLabel = [
    effortLabel(props.provider, props.effort),
    ...(props.supportsFastMode && props.fastModeEnabled ? ["Fast"] : []),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
          />
        }
      >
        <span>{triggerLabel}</span>
        <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuGroup>
          <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
            {props.provider === "codex" ? "Reasoning" : "Effort"}
          </div>
          <MenuRadioGroup
            value={props.effort}
            onValueChange={(value) => {
              if (!value) return;
              const nextEffort = props.options.find((option) => option === value);
              if (!nextEffort) return;
              props.onEffortChange(nextEffort);
            }}
          >
            {props.options.map((effort) => (
              <MenuRadioItem key={effort} value={effort}>
                {effortLabel(props.provider, effort)}
                {effort === defaultReasoningEffort ? " (default)" : ""}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        {props.supportsFastMode && props.onFastModeChange ? (
          <>
            <MenuDivider />
            <MenuGroup>
              <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Fast Mode</div>
              <MenuRadioGroup
                value={props.fastModeEnabled ? "on" : "off"}
                onValueChange={(value) => {
                  props.onFastModeChange?.(value === "on");
                }}
              >
                <MenuRadioItem value="off">off</MenuRadioItem>
                <MenuRadioItem value="on">on</MenuRadioItem>
              </MenuRadioGroup>
            </MenuGroup>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});
