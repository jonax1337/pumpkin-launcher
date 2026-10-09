import { activityText } from "@/components/friends/modRequestModel";
import { opText } from "@/components/friends/modRequestText";
import { useModActivity } from "@/hooks/useFriends";
import { useInstances } from "@/hooks/useInstances";
import { useI18n } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import type { ModActivityEntry } from "@/lib/types";
import { Chip, Count, Disclosure, Hint, List, ListRow, RowTitle } from "@/ui";
import { IconTile } from "./IconTile";

/**
 * „Aktivität im Spiel“ (docs/bridge/README.md, "Protocol 2"): was Spiele über das Freunde-Menü ausgelöst haben, neueste zuerst, mit Zeit, Instanz und Ergebnis.
 * Eingeklappt unter der Freundesliste, die Liste scrollt in fester Höhe. Ohne Vorgänge fehlt der Abschnitt ganz; die Liste lebt nur im Speicher des Launchers.
 */
export function ActivitySection() {
  const { t } = useI18n();
  const entries = useModActivity().data ?? [];
  const instanceNames = new Map(useInstances().data?.map((instance) => [instance.id, instance.name]));
  if (entries.length === 0) return null;
  return (
    <section className="friends-activity">
      <Disclosure summary={<>{t("friends.activity.title")}<Count value={entries.length} muted /></>}>
        <Hint icon="info" className="friends-block-note">{t("friends.activity.note")}</Hint>
        <div className="friends-activity-list" role="region" tabIndex={0} aria-label={t("friends.activity.title")}>
          <List variant="accounts" aria-label={t("friends.activity.title")}>
            {entries.map((entry) => (
              <ActivityRow key={`${entry.at}|${entry.instanceId}|${entry.op}|${entry.targetName}|${entry.ok}`} entry={entry} instanceName={instanceNames.get(entry.instanceId)} />
            ))}
          </List>
        </div>
      </Disclosure>
    </section>
  );
}

function ActivityRow({ entry, instanceName }: { entry: ModActivityEntry; instanceName: string | undefined }) {
  const { t } = useI18n();
  const when = formatDateTime(Date.parse(entry.at));
  return (
    <ListRow>
      <IconTile icon={entry.scope === "share" ? "share" : "friends"} />
      <RowTitle title={opText(activityText(entry))} sub={t("friends.activity.sub", { time: when, instance: instanceName ?? entry.instanceId })} />
      <Chip tone={entry.ok ? "run" : "warn"} icon={entry.ok ? "check" : "stop"}>{t(entry.ok ? "friends.activity.ok" : "friends.activity.failed")}</Chip>
    </ListRow>
  );
}
