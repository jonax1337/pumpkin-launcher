import { useId, useState } from "react";
import {
  Button, FormRow, FormSection, Hint, PageHeader, Select, StatusPanel, TabPanel, TextField,
  Workspace, WorkspaceContent, WorkspaceRail, WorkspaceTabs, type TabItem,
} from "@/ui";
import { cap } from "./kit-ui";

type Section = "general" | "java" | "sync";

const SECTIONS: TabItem<Section>[] = [
  { value: "general", label: "Allgemein", icon: "gear" },
  { value: "java", label: "Java", icon: "term" },
  { value: "sync", label: "Synchronisierung", icon: "up", disabled: true },
];
const JAVA_OPTIONS = [
  { value: "auto", label: "Automatisch" },
  { value: "21", label: "Java 21" },
  { value: "17", label: "Java 17" },
];

export function WorkspaceDemo() {
  const id = useId();
  const [section, setSection] = useState<Section>("general");
  const [name, setName] = useState("Survival");
  const [java, setJava] = useState("auto");
  const changed = name !== "Survival" || java !== "auto";

  return (
    <div data-kit="workspace">
      <PageHeader title="Instanz" count={2}>
        <Button size="s" disabled={!changed} onClick={() => { setName("Survival"); setJava("auto"); }}>
          Zurücksetzen
        </Button>
      </PageHeader>
      <Workspace rail={
        <WorkspaceRail aria-label="Instanzbereiche">
          <WorkspaceTabs idBase={id} label="Instanzbereiche" items={SECTIONS} value={section} onChange={setSection} />
          <Hint>Tab fokussiert die Auswahl. Pfeiltasten wechseln den Bereich; Pos1 und Ende springen.</Hint>
        </WorkspaceRail>
      }>
        <WorkspaceContent>
          <TabPanel idBase={id} value={section} tabIndex={0}>
            <div hidden={section !== "general"}>
              <FormSection title="Allgemein">
                <FormRow label="Name" htmlFor={`${id}-name`} hint="Nur in dieser Vorschau.">
                  <TextField id={`${id}-name`} value={name} maxLength={64} onChange={(event) => setName(event.target.value)} />
                </FormRow>
              </FormSection>
            </div>
            <div hidden={section !== "java"}>
              <FormSection title="Java">
                <FormRow label="Version" htmlFor={`${id}-java`} hint="Automatisch wählt die passende Laufzeit.">
                  <Select id={`${id}-java`} value={java} onChange={setJava} options={JAVA_OPTIONS} />
                </FormRow>
              </FormSection>
            </div>
          </TabPanel>
        </WorkspaceContent>
      </Workspace>
      <span style={cap}>Ohne Rail · volle Breite</span>
      <Workspace>
        <WorkspaceContent variant="plain">
          <StatusPanel size="s" icon="info" title={name || "Unbenannte Instanz"}>
            {java === "auto" ? "Java wird automatisch gewählt." : `Laufzeit: Java ${java}.`}
          </StatusPanel>
        </WorkspaceContent>
      </Workspace>
    </div>
  );
}
