import type { CatalogType, ProjectRef, Source } from "@/lib/content-types";
import { AddToInstanceMenu, AddToWorldMenu } from "./AddMenus";
import { PackActions, PackInstallButton } from "./PackInstall";

/**
 * Was man mit einem Projekt ohne Instanz-Kontext tun kann: Modpacks werden zu neuen Instanzen, Datenpakete landen in
 * einer Welt, alles andere in einer Instanz. `large` = im Projektkopf, sonst in der Katalogzeile.
 */
export function ContentAction({ type, project, source, large }: { type: CatalogType; project: ProjectRef; source: Source; large?: boolean }) {
  if (type === "modpack") return large ? <PackActions project={project} source={source} /> : <PackInstallButton project={project} source={source} />;
  if (type === "datapack") return <AddToWorldMenu project={project} large={large} />;
  return <AddToInstanceMenu project={project} type={type} source={source} large={large} />;
}
