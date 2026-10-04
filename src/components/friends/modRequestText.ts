import { t, type TKey } from "@/i18n/core";
import type { OpLine } from "./modRequestModel";

/** Der Text eines Vorgangs; die Person steht als reiner Text darin, so wie die Mod sie nannte (der Launcher hat sie bereinigt). */
export const opText = (line: OpLine<TKey>) => t(line.key, { name: line.name ?? t("friends.activity.someone"), op: line.op });
