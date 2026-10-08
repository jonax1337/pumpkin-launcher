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
  if (diagnoses.isError) return <Hint tone="warn" className="mb-2.5">{t("crashAssistant.loadFailed")} {diagnoses.error.message}</Hint>;
  if (!diagnoses.data?.length) return null;
  return (
    <section aria-label={t("crashAssistant.heading")} className="mb-2.5 flex flex-col gap-2.5">
      {diagnoses.data.map((diagnosis) => (
        <DiagnosisCard key={diagnosis.id} diagnosis={diagnosis} instance={instance} busy={busy} onApply={apply} />
      ))}
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
      >
        {t(text.body, textParams(diagnosis))}
      </StatusPanel>
      {(actions.length > 0 || evidence.length > 0) && (
        <div className="px-3 pt-2">
          {actions.length > 0 && (
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
          {evidence.length > 0 && (
            <Disclosure summary={t("crashAssistant.evidence")} className={actions.length > 0 ? "mt-1" : undefined}>
              <ul className="m-0 list-none p-0">
                {evidence.map((line) => (
                  <li key={line} className="break-words font-mono text-[length:calc(13px*var(--tz))] text-fg-3">{line}</li>
                ))}
              </ul>
            </Disclosure>
          )}
        </div>
      )}
    </div>
  );
}
