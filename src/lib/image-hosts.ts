/** Bild-Hosts, von denen Beschreibungen ohne Rückfrage Bilder laden: die Anbieter selbst und deren übliche Bildspeicher. */
export const TRUSTED_IMAGE_HOSTS: readonly string[] = [
  "cdn.modrinth.com",
  "media.forgecdn.net",
  "raw.githubusercontent.com",
  "avatars.githubusercontent.com",
  "user-images.githubusercontent.com",
  "media.githubusercontent.com",
  "i.imgur.com",
];

/** Adresse als https-URL, sonst `null`. */
export function parseHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Darf die Beschreibung dieses Bild ohne Klick laden? Jeder andere Host sähe die IP-Adresse des Spielers. */
export function isTrustedImageUrl(value: string): boolean {
  const url = parseHttpsUrl(value);
  return url !== null && TRUSTED_IMAGE_HOSTS.includes(url.hostname);
}
