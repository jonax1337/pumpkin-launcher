import { useEffect, type MouseEvent } from "react";
import { useI18n } from "@/i18n";
import { Icon } from "@/ui";
import type { PaletteItem, PaletteSection } from "./paletteModel";

/** DOM-Kennung eines Eintrags; `aria-activedescendant` des Eingabefelds zeigt darauf. */
export const optionId = (listId: string, item: PaletteItem) => `${listId}-${item.id}`;

const groupHeadId = (listId: string, section: PaletteSection) => `${listId}-group-${section.id}`;

interface PaletteOptionProps {
  id: string;
  item: PaletteItem;
  active: boolean;
  onActivate: (item: PaletteItem) => void;
  onRun: (item: PaletteItem) => void;
}

function PaletteOption({ id, item, active, onActivate, onRun }: PaletteOptionProps) {
  const detail = item.disabledReason ?? item.subtitle;
  // Ein Scrollen unter dem ruhenden Zeiger löst eine Mausbewegung ohne Weg aus und risse die Markierung von der Tastatur weg.
  function followPointer(e: MouseEvent) {
    if (e.movementX !== 0 || e.movementY !== 0) onActivate(item);
  }
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={item.disabledReason ? true : undefined}
      className="vx-pal-opt"
      data-active={active ? "" : undefined}
      onMouseMove={followPointer}
      // Der Fokus bleibt im Eingabefeld.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onRun(item)}
    >
      <Icon name={item.icon} size="s" />
      <span className="vx-pal-t">
        <span className="vx-pal-n">{item.title}</span>
        {detail && <span className="vx-pal-s">{detail}</span>}
      </span>
    </div>
  );
}

/** Die Ergebnisse als Listbox in Gruppen; gewählt wird per `aria-activedescendant` des Eingabefelds, nicht per Fokus. */
export function PaletteList({ id, sections, active, onActivate, onRun }: {
  id: string;
  sections: PaletteSection[];
  active: PaletteItem | undefined;
  onActivate: (item: PaletteItem) => void;
  onRun: (item: PaletteItem) => void;
}) {
  const { t } = useI18n();
  const activeDomId = active && optionId(id, active);

  useEffect(() => {
    if (activeDomId) document.getElementById(activeDomId)?.scrollIntoView({ block: "nearest" });
  }, [activeDomId]);

  return (
    <div id={id} role="listbox" aria-label={t("palette.listLabel")} className="vx-pal-list">
      {sections.map((section) => (
        <div key={section.id} role="group" aria-labelledby={groupHeadId(id, section)}>
          <div id={groupHeadId(id, section)} className="vx-mlabel">{t(`palette.group.${section.id}`)}</div>
          {section.items.map((item) => (
            <PaletteOption
              key={item.id}
              id={optionId(id, item)}
              item={item}
              active={item.id === active?.id}
              onActivate={onActivate}
              onRun={onRun}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
