/** Eigene Datei, damit `useInstances` und `useWorlds` einander nicht importieren müssen. */
export const worldKeys = {
  /** Welten, Sicherungen und Serverliste einer Instanz (z. B. nach dem Spielen neu laden). */
  all: (instanceId: string) => ["worlds", instanceId] as const,
  list: (instanceId: string) => ["worlds", instanceId, "list"] as const,
  backups: (instanceId: string) => ["worlds", instanceId, "backups"] as const,
  servers: (instanceId: string) => ["worlds", instanceId, "servers"] as const,
  datapacks: (instanceId: string, worldId: string) => ["worlds", instanceId, "datapacks", worldId] as const,
};
