import { Fragment, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import { Button, Chip, IconButton } from "@/ui";
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
      <table className="vtab">
        <caption className="sr">{t("components.detail.allVersions")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("common.version")}</th>
            <th scope="col">{t("components.detail.colType")}</th>
            <th scope="col">Minecraft</th>
            <th scope="col" className="vtab-opt">{t("components.common.loader")}</th>
            <th scope="col" className="vtab-opt">{t("components.detail.colDate")}</th>
            <th scope="col"><span className="sr">{t("components.detail.colActions")}</span></th>
          </tr>
        </thead>
        <tbody>
          {versions.slice(0, limit).map((v) => {
            const logId = `vlog-${v.id}`;
            const logOpen = openLog === v.id;
            return (
              <Fragment key={v.id}>
                <tr>
                  <td>
                    <b className="vtab-name">{v.version_number}</b>
                    {v.name !== v.version_number && <span className="vtab-sub">{v.name}</span>}
                  </td>
                  <td><Chip size="s" tone={typeTone(v)}>{versionTypeName(v)}</Chip></td>
                  <td>{minecraftOf(v)}</td>
                  <td className="vtab-opt">{versionLoadersOrVanilla(v)}</td>
                  <td className="vtab-opt">{publishedOn(v)}</td>
                  <td className="vtab-act">
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
                  </td>
                </tr>
                {logOpen && v.changelog && (
                  <tr id={logId} className="vtab-log">
                    <td colSpan={columns}><Description body={v.changelog} /></td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {versions.length > limit && (
        <div className="morebar">
          <Button onClick={() => setLimit(limit + MORE_ROWS)}>{t("components.detail.moreVersions", { n: versions.length - limit })}</Button>
        </div>
      )}
    </>
  );
}
