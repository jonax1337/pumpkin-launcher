import { useI18n } from "@/i18n";
import { Actions, Button, Disclosure, Hint, StatusPanel } from "@/ui";
import { useCrashDiagnosis } from "@/hooks/useCrashDiagnosis";
import type { CrashDiagnosis, CrashFixAction } from "@/lib/crash-types";
import type { Instance } from "@/lib/types";
import { ACTION_ICONS, actionLabel, isApplied } from "./actions";
import { DIAGNOSIS_TEXTS, SEVERITY_LABELS, SEVERITY_TONE, textParams } from "./texts";
import { useCrashActions } from "./useCrashActions";

/**
 * Was zum letzten Absturz der Instanz gefunden wurde: je Befund Titel, Erklärung, Knöpfe für die Handgriffe und der Auszug
 * aus dem Bericht zum Aufklappen. Ohne Befund erscheint nichts. `onAddContent` öffnet das Hinzufügen von Inhalten mit der Suche.
 */
export function CrashAssistant({ instance, onAddContent }: { instance: Instance; onAddContent: (query: string) => void }) {
  const { t } = useI18n();
  const diagnoses = useCrashDiagnosis(instance.id);
  const { apply, busy } = useCrashActions(instance, onAddContent);
  if (diagnoses.isError) return <Hint tone="warn">{t("crashAssistant.loadFailed")} {diagnoses.error.message}</Hint>;
  if (!diagnoses.data?.length) return null;
  const [first, ...rest] = diagnoses.data;
  const card = (diagnosis: CrashDiagnosis) => (
    <DiagnosisCard key={diagnosis.id} diagnosis={diagnosis} instance={instance} busy={busy} onApply={apply} />
  );
  // Weitere Befunde sind eingeklappt, damit die Konsole darunter sichtbar bleibt.
  return (
    <section aria-label={t("crashAssistant.heading")} className="crash-list">
      {card(first)}
      {rest.length > 0 && (
        <Disclosure summary={t("crashAssistant.more", { n: rest.length })}>
          <div className="crash-list">{rest.map(card)}</div>
        </Disclosure>
      )}
    </section>
  );
}

function DiagnosisCard({ diagnosis, instance, busy, onApply }: {
  diagnosis: CrashDiagnosis; instance: Instance; busy: boolean; onApply: (action: CrashFixAction) => void;
}) {
  const { t } = useI18n();
  const text = DIAGNOSIS_TEXTS[diagnosis.id];
  const { actions, evidence } = diagnosis;
  return (
    <div>
      <StatusPanel
        tone={SEVERITY_TONE[diagnosis.severity]}
        title={<><span className="sr">{t(SEVERITY_LABELS[diagnosis.severity])}: </span>{t(text.title)}</>}
        actions={actions.length > 0 && (
          <Actions wrap>
            {actions.map((action, index) => {
              const applied = isApplied(action, instance);
              return (
                <Button
                  key={JSON.stringify(action)}
                  size="s"
                  variant={index === 0 ? "primary" : "secondary"}
                  icon={applied ? "check" : ACTION_ICONS[action.type]}
                  disabled={applied || busy}
                  onClick={() => onApply(action)}
                >
                  {actionLabel(action, instance, actions)}
                </Button>
              );
            })}
          </Actions>
        )}
      >
        {t(text.body, textParams(diagnosis))}
      </StatusPanel>
      {evidence.length > 0 && (
        <div className="crash-more">
          <Disclosure summary={t("crashAssistant.evidence")}>
            <ul className="crash-lines">
              {evidence.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Disclosure>
        </div>
      )}
    </div>
  );
}
