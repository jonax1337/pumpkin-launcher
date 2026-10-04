import { activityText } from "@/components/friends/modRequestModel";
import { opText } from "@/components/friends/modRequestText";
import { useModActivity } from "@/hooks/useFriends";
import { useInstances } from "@/hooks/useInstances";
import { useI18n } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import type { ModActivityEntry } from "@/lib/types";
import { Chip, Hint, Icon, List, ListRow, RowTitle, SectionHeader } from "@/ui";

/**
 * „Aktivität im Spiel“ (INGAME 5.7): was Spiele über das Freunde-Menü ausgelöst haben, neueste zuerst, mit Zeit, Instanz und Ergebnis.
 * Ohne Vorgänge fehlt der Abschnitt ganz; die Liste lebt nur im Speicher des Launchers.
 */
export function ActivitySection() {
  const { t } = useI18n();
  const entries = useModActivity().data ?? [];
  const instanceNames = new Map(useInstances().data?.map((instance) => [instance.id, instance.name]));
  if (entries.length === 0) return null;
  return (
    <section className="mt-6">
      <SectionHeader title={t("friends.activity.title")} size="sub" as="h2" />
      <Hint icon="info" className="mt-1 mb-2.5">{t("friends.activity.note")}</Hint>
      <List variant="accounts" aria-label={t("friends.activity.title")}>
        {entries.map((entry) => (
          <ActivityRow key={`${entry.at}|${entry.instanceId}|${entry.op}|${entry.targetName}|${entry.ok}`} entry={entry} instanceName={instanceNames.get(entry.instanceId)} />
        ))}
      </List>
    </section>
  );
}

function ActivityRow({ entry, instanceName }: { entry: ModActivityEntry; instanceName: string | undefined }) {
  const { t } = useI18n();
  const when = formatDateTime(Date.parse(entry.at));
  return (
    <ListRow>
      <span className="vx-av" data-box="32"><Icon name={entry.scope === "share" ? "share" : "users"} size="l" /></span>
      <RowTitle title={opText(activityText(entry))} sub={t("friends.activity.sub", { time: when, instance: instanceName ?? entry.instanceId })} />
      <Chip tone={entry.ok ? "run" : "warn"} icon={entry.ok ? "check" : "stop"}>{t(entry.ok ? "friends.activity.ok" : "friends.activity.failed")}</Chip>
    </ListRow>
  );
}
