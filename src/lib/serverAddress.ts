/** Serveradressen wie im Spiel: `host[:port]` mit Hostname, IPv4 oder `[IPv6]`. Dieselben Regeln prüft das Backend (`servers.rs`). */

export const SERVER_ADDRESS_MAX_LENGTH = 255;

const MAX_HOST_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
const MAX_PORT = 65535;
const LABEL = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_-]*[\p{L}\p{N}_])?$/u;
const IPV6_GROUP = /^[0-9a-f]{1,4}$/i;
const IPV4_OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4_TAIL = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);
const IPV6_GROUPS = 8;
const PORT_DIGITS = /^\d+$/;

/** Ob `address` (ohne Randleerzeichen gelesen) eine gültige Serveradresse ist. */
export function isValidServerAddress(address: string): boolean {
  const text = address.trim();
  if (text.length > SERVER_ADDRESS_MAX_LENGTH) return false;
  const parts = splitHostPort(text);
  return parts != null && isValidPort(parts.port);
}

/** Vorschlag für den Namen eines Servers: der Host seiner Adresse, auch während die Adresse noch getippt wird. */
export function serverNameFromAddress(address: string): string {
  return address.trim().replace(/:\d*$/, "");
}

function splitHostPort(address: string): { port: string | null } | null {
  if (address.startsWith("[")) {
    const close = address.indexOf("]");
    const host = address.slice(1, close);
    const rest = address.slice(close + 1);
    const portPart = rest === "" ? null : rest.startsWith(":") ? rest.slice(1) : undefined;
    return close > 0 && portPart !== undefined && isIpv6(host) ? { port: portPart } : null;
  }
  const colon = address.indexOf(":");
  const host = colon < 0 ? address : address.slice(0, colon);
  return isHostname(host) ? { port: colon < 0 ? null : address.slice(colon + 1) } : null;
}

function isHostname(host: string): boolean {
  return host.length <= MAX_HOST_LENGTH && host.split(".").every((label) => label.length <= MAX_LABEL_LENGTH && LABEL.test(label));
}

/** Wie `Ipv6Addr::parse`: acht Gruppen aus 1 bis 4 Hexziffern, höchstens einmal `::` für eine oder mehr Nullgruppen, am Ende auch IPv4. */
function isIpv6(host: string): boolean {
  const halves = host.split("::");
  if (halves.length > 2) return false;
  const groups = halves.flatMap((half) => (half === "" ? [] : half.split(":")));
  const tail = groups.at(-1);
  const hasIpv4Tail = tail != null && tail.includes(".") && halves.at(-1) !== "";
  const hexGroups = hasIpv4Tail ? groups.slice(0, -1) : groups;
  if (!hexGroups.every((group) => IPV6_GROUP.test(group)) || (hasIpv4Tail && !IPV4_TAIL.test(tail))) return false;
  const count = hexGroups.length + (hasIpv4Tail ? 2 : 0);
  return halves.length === 2 ? count < IPV6_GROUPS : count === IPV6_GROUPS;
}

function isValidPort(port: string | null): boolean {
  return port == null || (PORT_DIGITS.test(port) && Number(port) >= 1 && Number(port) <= MAX_PORT);
}
