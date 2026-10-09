import { InstanceMenuButton } from "@/components/instance";
import { PlayButton } from "@/components/play/PlayButton";
import type { Instance } from "@/lib/types";
import { Actions } from "@/ui";

export function HeroActions({ instance }: { instance: Instance }) {
  return (
    <Actions gap={12} wrap>
      <PlayButton key={instance.id} instance={instance} main />
      <InstanceMenuButton instance={instance} size="l" onScene />
    </Actions>
  );
}
