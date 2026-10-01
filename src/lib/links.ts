import { api } from "@/lib/api";
import { toastError } from "@/lib/toast";

/** Seite im Browser öffnen; scheitert das, sagt es ein Toast. */
export const openPage = (url: string) => void api.openExternal(url).catch(toastError);
