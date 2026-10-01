import { toast } from "sonner";
import { api } from "@/lib/api";

/** Seite im Browser öffnen; scheitert das, sagt es ein Toast. */
export const openPage = (url: string) => void api.openExternal(url).catch((e: Error) => toast.error(e.message));
