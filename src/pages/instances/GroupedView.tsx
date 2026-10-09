import { useI18n } from "@/i18n";
import { ungrouped } from "@/hooks/useInstances";
import { useLookStore } from "@/store/look";
import { focusSoon } from "@/pages/detail/content/focus";
import { Count, Disclosure, Heading, IconButton } from "@/ui";
import { InstanceItems, InstanceListHeader } from "./InstanceView";
import { movedGroup, type Section } from "./libraryModel";

type Step = -1 | 1;

/** Nach vorn und nach hinten schieben: zwei Knöpfe am Abschnittskopf, über Tab und Eingabe wie mit der Maus erreichbar. */
function MoveButtons({ group, groups, onMove }: { group: string; groups: string[]; onMove: (group: string, step: Step) => void }) {
  const { t } = useI18n();
  const at = groups.indexOf(group);
  const buttons: { step: Step; icon: "chev-up" | "chev-down"; label: string; disabled: boolean }[] = [
    { step: -1, icon: "chev-up", label: t("pages.instances.moveGroupUp", { name: group }), disabled: at <= 0 },
    { step: 1, icon: "chev-down", label: t("pages.instances.moveGroupDown", { name: group }), disabled: at >= groups.length - 1 },
  ];
  return (
    <div className="lib-group-move">
      {buttons.map(({ step, icon, label, disabled }) => (
        <IconButton key={step} size="s" icon={icon} label={label} disabled={disabled} data-move-group={group} data-move-step={step} onClick={() => onMove(group, step)} />
      ))}
    </div>
  );
}

/**
 * Gruppen als aufklappbare Listenabschnitte in der gewählten Reihenfolge; zugeklappte und die Reihenfolge merkt sich der Look-Store
 * über den Neustart hinaus. `groups`: alle Gruppen in dieser Reihenfolge. `reorderable`: Verschieben anbieten (nur ungefiltert,
 * sonst wäre unklar, an wem vorbei eine Gruppe wandert). Die Listenansicht trägt ihren Spaltenkopf einmal über allen Gruppen.
 */
export function GroupedView({ sections, groups, reorderable }: { sections: Section[]; groups: string[]; reorderable: boolean }) {
  const collapsed = useLookStore((s) => s.collapsed);
  const setCollapsed = useLookStore((s) => s.setCollapsed);
  const setGroupOrder = useLookStore((s) => s.setGroupOrder);

  function move(group: string, step: Step) {
    const next = movedGroup(groups, group, step);
    setGroupOrder(next);
    // Das verschobene Abschnittselement zieht im DOM um und verliert dabei den Fokus; am Rand ist der andere Knopf der nächste.
    const at = next.indexOf(group);
    const stillPossible = step === -1 ? at > 0 : at < next.length - 1;
    const refocusStep = stillPossible ? step : -step;
    focusSoon(() =>
      [...document.querySelectorAll<HTMLElement>("[data-move-group]")].find(
        (button) => button.dataset.moveGroup === group && button.dataset.moveStep === String(refocusStep),
      ),
    );
  }

  return (
    <div className="lib-groups">
      <InstanceListHeader />
      {sections.map(([group, members]) => {
        // Schlüssel ist die Gruppe selbst ("" = ohne Gruppe): eine Gruppe darf auch „Ohne Gruppe“ heißen.
        const key = group ?? "";
        return (
          <div key={key} className="lib-group">
            {group !== null && reorderable && <MoveButtons group={group} groups={groups} onMove={move} />}
            <Disclosure
              summaryClassName="ml-0 h-10 pl-2"
              open={!collapsed.includes(key)}
              onToggle={(open) => setCollapsed(key, !open)}
              summary={<><Heading level="card" as="h3" zoom className="leading-[1.1] tracking-[.02em]">{group ?? ungrouped()}</Heading> <Count value={members.length} muted /></>}
            >
              <InstanceItems instances={members} label={group ?? ungrouped()} />
            </Disclosure>
          </div>
        );
      })}
    </div>
  );
}
