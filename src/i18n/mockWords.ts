import { mock as de } from "./de/mock.ts";
import { mock as en } from "./en/mock.ts";

/** Texte, die nur der Browser-Mock im Dev-Server braucht. `index.tsx` lädt sie nur dort; der Release-Build enthält sie nicht. */
export const mockWords = { de, en };
