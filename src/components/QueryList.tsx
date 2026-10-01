import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { ErrorBox, Skel } from "@/ui";

/** Fehler, Laden und leere Liste einer Abfrage; sonst `children` mit den Einträgen. `loading` ersetzt den Standard-Platzhalter. */
export function QueryList<T>({ query, error, empty, loading = <Skel h={56} />, children }: {
  query: UseQueryResult<T[]>;
  error: string;
  empty: ReactNode;
  loading?: ReactNode;
  children: (items: T[]) => ReactNode;
}) {
  if (query.error) return <ErrorBox title={error} error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return loading;
  return query.data.length ? children(query.data) : empty;
}
