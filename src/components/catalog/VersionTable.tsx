import { Fragment, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import { Button, Chip, IconButton, Table, Td, Th, Tr } from "@/ui";
import { Description } from "@/components/Description";
import type { ContentVersion } from "@/lib/content-types";
import { formatDate } from "@/lib/format";
import { versionLoadersOrVanilla, versionTypeName } from "./labels";

/** So viele Versionen zeigt die Tabelle zuerst, „Mehr anzeigen“ legt je Klick so viele dazu. */
const FIRST_ROWS = 10;
const MORE_ROWS = 20;

/** Die jüngste Minecraft-Version der Version, bei mehreren mit der Zahl der weiteren („1.21.4 +3“). */
const minecraftOf = ({ game_versions: games }: ContentVersion) => (games.length > 1 ? `${games.at(-1)} +${games.length - 1}` : (games[0] ?? "–"));

const publishedOn = ({ date_published: published }: ContentVersion) => (published ? formatDate(Date.parse(published)) : "–");

/** Beta und Alpha sind Vorabversionen und fallen auf; ein Release ist der Normalfall. */
const typeTone = (version: ContentVersion) => (version.version_type === "release" ? undefined : "warn");

/** Spalten, die in schmalen Containern (unter 600 px) entfallen: Loader und Datum. */
const OPTIONAL = "@max-[600px]:hidden";

/**
 * Alle Versionen eines Projekts als Tabelle: Nummer, Art (Release, Beta, Alpha), Minecraft, Loader, Datum und, wo der
 * Anbieter sie mitliefert, die Änderungen zum Aufklappen. `action` ist die Aktion je Version (z. B. „Anlegen“).
 */
export function VersionTable({ versions, action }: { versions: ContentVersion[]; action?: (version: ContentVersion) => ReactNode }) {
  const { t } = useI18n();
  const [limit, setLimit] = useState(FIRST_ROWS);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const columns = action ? 6 : 5;
  return (
    <>
      <Table>
        <caption className="sr">{t("components.detail.allVersions")}</caption>
        <thead>
          <tr>
            <Th>{t("common.version")}</Th>
            <Th>{t("components.detail.colType")}</Th>
            <Th>Minecraft</Th>
            <Th className={OPTIONAL}>{t("components.common.loader")}</Th>
            <Th className={OPTIONAL}>{t("components.detail.colDate")}</Th>
            <Th><span className="sr">{t("components.detail.colActions")}</span></Th>
          </tr>
        </thead>
        <tbody>
          {versions.slice(0, limit).map((v) => {
            const logId = `vlog-${v.id}`;
            const logOpen = openLog === v.id;
            return (
              <Fragment key={v.id}>
                <Tr>
                  <Td>
                    <b className="block font-bold text-(color:--fg)">{v.version_number}</b>
                    {v.name !== v.version_number && <span className="block max-w-[40ch] truncate text-ctl-s text-(color:--fg-3)">{v.name}</span>}
                  </Td>
                  <Td><Chip size="s" tone={typeTone(v)}>{versionTypeName(v)}</Chip></Td>
                  <Td>{minecraftOf(v)}</Td>
                  <Td className={OPTIONAL}>{versionLoadersOrVanilla(v)}</Td>
                  <Td className={OPTIONAL}>{publishedOn(v)}</Td>
                  <Td className="pr-0 text-right whitespace-nowrap [&>*]:align-middle">
                    {v.changelog?.trim() && (
                      <IconButton
                        size="s"
                        icon={logOpen ? "chev-up" : "chev-down"}
                        label={t("components.detail.changelogOf", { version: v.version_number })}
                        aria-expanded={logOpen}
                        aria-controls={logId}
                        onClick={() => setOpenLog(logOpen ? null : v.id)}
                      />
                    )}
                    {action?.(v)}
                  </Td>
                </Tr>
                {logOpen && v.changelog && (
                  <Tr sub id={logId}>
                    <Td colSpan={columns} className="p-0 pb-3.5"><Description body={v.changelog} className="mt-3.5 max-w-none min-w-0" /></Td>
                  </Tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
      {versions.length > limit && (
        <div className="morebar">
          <Button onClick={() => setLimit(limit + MORE_ROWS)}>{t("components.detail.moreVersions", { n: versions.length - limit })}</Button>
        </div>
      )}
    </>
  );
}
