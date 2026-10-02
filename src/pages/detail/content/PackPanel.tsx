import { irisSupported } from "@/components/catalog/iris";
import { useI18n } from "@/i18n";
import { Chip, Hint, IconButton, Panel, ProjectIcon, SectionHeader, Select } from "@/ui";
import type { MoveDirection } from "@/lib/packs";
import { LOADER_LABELS, type Mod, type ModLoader } from "@/lib/types";
import { useContentModel } from "./ContentModel";
import { focusSoon } from "./focus";
import type { PackPanelState } from "./usePackControls";

/** So wählt man ein Shaderpaket ab: Radix kennt keinen leeren Wert, der Dateiname „none“ kommt nicht vor (Shader sind .zip). */
const NO_SHADER = "none";

/** Nach dem Verschieben bleibt der Fokus am Knopf der Richtung, sonst am anderen (am Rand ist einer gesperrt). */
function focusMoveButton(root: HTMLElement | null, mod: Mod, direction: MoveDirection) {
  const other = direction === "up" ? "down" : "up";
  focusSoon(() =>
    [direction, other]
      .map((way) => root?.querySelector<HTMLButtonElement>(`[data-pack-move="${CSS.escape(mod.id)}:${way}"]:not(:disabled)`))
      .find(Boolean),
  );
}

/**
 * Gewählte Ressourcenpakete in der Reihenfolge des Spiels: oben gewinnt. Verschieben per Knopf oder Alt + Pfeil hoch/runter,
 * Abwählen per Knopf. `say` meldet Screenreadern den neuen Platz.
 */
export function ResourcePackPanel({ packs, say }: { packs: PackPanelState; say: (text: string) => void }) {
  const { t } = useI18n();
  const { titleOf, iconOf, packs: controls } = useContentModel();
  const { activeOrder, movePack } = packs;
  const blocked = !!controls.blocked;

  function moveTo(mod: Mod, direction: MoveDirection, list: HTMLElement | null) {
    const place = movePack(mod, direction);
    say(t("detail.packs.moved", { name: titleOf(mod), place, total: activeOrder.length }));
    focusMoveButton(list, mod, direction);
  }

  return (
    <Panel pad="m" className="mb-3">
      <SectionHeader as="h3" size="card" title={t("detail.packs.title")} />
      <p className="text-fg-3 m-0 text-[13px]">{t("detail.packs.sub")} {t("detail.packs.moveHint")}</p>
      {controls.blocked && <Hint tone="warn" className="mt-2">{controls.blocked}</Hint>}
      {activeOrder.length === 0 ? (
        <p className="text-fg-2 mt-2 mb-0 text-[13px]">{t("detail.packs.empty")}</p>
      ) : (
        <ol className="m-0 mt-2 list-none p-0" aria-label={t("detail.packs.title")}>
          {activeOrder.map((mod, index) => (
            <li
              key={mod.id}
              className="flex items-center gap-3 py-1"
              onKeyDown={(e) => {
                if (!e.altKey || blocked || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                e.preventDefault();
                moveTo(mod, e.key === "ArrowUp" ? "up" : "down", e.currentTarget.parentElement);
              }}
            >
              <span className="text-fg-3 w-5 text-right text-[13px]" aria-hidden>{index + 1}</span>
              <ProjectIcon url={iconOf(mod)} seed={mod.id} />
              <b className="min-w-0 flex-1 truncate">{titleOf(mod)}</b>
              {controls.isIncompatible(mod) && <Chip size="s" tone="warn" dot>{t("detail.packs.incompatible")}</Chip>}
              <IconButton
                size="s"
                icon="up"
                data-pack-move={`${mod.id}:up`}
                label={t("detail.packs.up", { name: titleOf(mod) })}
                disabled={blocked || index === 0}
                onClick={(e) => moveTo(mod, "up", e.currentTarget.closest("ol"))}
              />
              <IconButton
                size="s"
                icon="down"
                data-pack-move={`${mod.id}:down`}
                label={t("detail.packs.down", { name: titleOf(mod) })}
                disabled={blocked || index === activeOrder.length - 1}
                onClick={(e) => moveTo(mod, "down", e.currentTarget.closest("ol"))}
              />
              <IconButton
                size="s"
                icon="x"
                label={t("detail.packs.deactivate", { name: titleOf(mod) })}
                disabled={blocked}
                onClick={() => controls.setActive(mod, false)}
              />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** Das Shaderpaket, das Iris beim Start lädt (`config/iris.properties`); ohne Iris gibt es nichts zu wählen. */
export function ShaderPanel({ packs, shaders, hasIris, loader }: { packs: PackPanelState; shaders: Mod[]; hasIris: boolean; loader: ModLoader }) {
  const { t } = useI18n();
  const { titleOf, packs: controls } = useContentModel();
  const { shaderFile, setShaderFile } = packs;
  const known = shaders.filter((m) => m.enabled).map((m) => ({ value: m.fileName, label: titleOf(m) }));
  const unknown = shaderFile && !known.some((o) => o.value === shaderFile) ? [{ value: shaderFile, label: t("detail.packs.unknownShader", { name: shaderFile }) }] : [];
  return (
    <Panel pad="m" className="mb-3">
      <SectionHeader as="h3" size="card" title={t("detail.packs.shaderTitle")} />
      <p className="text-fg-3 m-0 mb-2 text-[13px]">{t("detail.packs.shaderSub")}</p>
      {!hasIris && (
        <Hint tone="warn" className="mb-2">
          {irisSupported({ loader }) ? t("detail.content.shaderNeedsIris") : t("detail.content.shadersUnsupportedDetail", { loader: LOADER_LABELS[loader] })}
        </Hint>
      )}
      {controls.blocked && <Hint tone="warn" className="mb-2">{controls.blocked}</Hint>}
      <Select
        size="s"
        label={t("detail.packs.shaderLabel")}
        value={shaderFile ?? NO_SHADER}
        disabled={!hasIris || !!controls.blocked || !controls.available}
        onChange={(file) => setShaderFile(file === NO_SHADER ? null : file)}
        options={[{ value: NO_SHADER, label: t("detail.packs.shaderNone") }, ...known, ...unknown]}
      />
    </Panel>
  );
}
