import { InstanceMenuButton } from "@/components/instance";
import { PlayButton } from "@/components/play/PlayButton";
import type { Instance } from "@/lib/types";

export function HeroActions({ instance }: { instance: Instance }) {
  return (
    <div className="acts">
      <PlayButton key={instance.id} instance={instance} main />
      <InstanceMenuButton instance={instance} onScene size="l" />
    </div>
  );
}
