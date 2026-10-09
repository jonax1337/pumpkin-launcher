import { useI18n } from "@/i18n";
import { shortcutLabel } from "../shortcuts";
import { Kbd, Listbox, ListboxGroup, ListboxOption } from "@/ui";
import type { PaletteItem, PaletteSection } from "./paletteModel";

/** DOM-Kennung eines Eintrags; `aria-activedescendant` des Eingabefelds zeigt darauf. */
export const optionId = (listId: string, item: PaletteItem) => `${listId}-${item.id}`;

interface PaletteOptionProps {
  id: string;
  item: PaletteItem;
  active: boolean;
  onActivate: (item: PaletteItem) => void;
  onRun: (item: PaletteItem) => void;
}

function PaletteOption({ id, item, active, onActivate, onRun }: PaletteOptionProps) {
  const { t } = useI18n();
  return (
    <ListboxOption
      id={id}
      icon={item.icon}
      sub={item.disabledReason ?? item.subtitle}
      active={active}
      disabled={!!item.disabledReason}
      onActivate={() => onActivate(item)}
      onClick={() => onRun(item)}
      // Rechts: Tastenkürzel des Befehls; der markierte, ausführbare Eintrag zeigt zusätzlich Enter
      trail={
        <>
          {item.shortcut && <Kbd size="s">{shortcutLabel(item.shortcut, t)}</Kbd>}
          {active && !item.disabledReason && <Kbd size="s">{t("palette.key.enter")}</Kbd>}
        </>
      }
    >
      {item.title}
    </ListboxOption>
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
  return (
    <Listbox id={id} label={t("palette.listLabel")} className="min-h-0 flex-1">
      {sections.map((section) => (
        <ListboxGroup key={section.id} label={t(`palette.group.${section.id}`)}>
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
        </ListboxGroup>
      ))}
    </Listbox>
  );
}
