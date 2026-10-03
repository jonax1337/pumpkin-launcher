# Pumpkin Friends: privacy, relay and compliance

Work package D1. This file is the wording basis for the in-app PrivacyNotice, the opt-in dialog
and the relay information (SPEC 12.1 is the normative source for what the feature does). The relay
runbook is [`RELAY-OPS.md`](RELAY-OPS.md).

**Status: draft for the owner's review.** It is not legal advice. Items marked **(owner)** need a
decision or a fact only the owner has (name and address of the operator, the hosting provider,
the abuse mailbox). Everything else was derived from the spec and from the `iroh-relay` 1.3.0 source.

## 1. Summary

- Friends is **off by default**. Before the owner of a PC switches it on, nothing binds UDP, listens,
  or contacts a relay or Mojang for friends (SPEC 12.1).
- Friends connect only through codes that the users exchange themselves. There is no public list and no
  search, no chat, no tracking, no telemetry.
- Connections are encrypted end to end between the launchers. The relay forwards ciphertext.
- Our own relay stores nothing about connections. It sees, while a connection is open, the client's IP
  address and its endpoint id, and who it forwards to.

## 2. Data map

| Data | Who sees it | Where it is stored | Why |
|---|---|---|---|
| Display name (3 to 32 characters), Minecraft name and UUID (self-asserted) | Confirmed friends | Locally at each friend, locally at the user | Show who a friend is |
| Online and playing status | Confirmed friends only | Not stored by us (kept in memory by the friend's launcher; `lastSeen` is stored locally) | Presence |
| Hosting a world, version, loader, mod list (manifest) | Invited friends only | Not stored by us | Join a shared world |
| Permanent identity key | Nobody. Only the derived id (64 hex) is shared with friends | The OS keychain, never in a file | Authenticate friends |
| Friend code (80 characters, valid 7 days, single use) | Whoever the user gives it to | Hash only on the inviter's PC; the code is shown once | Add a friend |
| Public IP and local network addresses | The other end of a **direct** connection (a friend; with "always relay" off also a code holder, see section 5) | Not stored by us | Connect directly |
| IP address and endpoint id of a connected launcher | The relay operator, while the connection is open | Memory of the relay process only (section 3.4) | Forward packets, find the peer |
| Minecraft UUID of a friend | Mojang's sessionserver | Skin image is cached locally | Show the friend's skin |
| World traffic between the players | The two launchers | Nowhere | The game itself |

## 3. The relay (GDPR information text, Art. 13)

### 3.1 Controller

Operator of the relay: **(owner)** name, postal address, e-mail. Contact for privacy questions:
**(owner)** `privacy@<relay-domain>`. A data protection officer is not required for this scale
(to be confirmed by the owner).

Hosting provider (processor): **(owner)** provider name and data centre location (EU). A data processing
agreement (AVV, Art. 28 GDPR) has to be in place before launch.

### 3.2 What the relay processes

- The **IP address and port** of every launcher that connects (TCP 443 for relaying, UDP 7842 for address
  discovery) and the **endpoint id** (the public key of the connecting endpoint).
- Which endpoint asks the relay to forward to which other endpoint ("who talks to whom"), the amount of data
  and the timing, as far as needed to forward it.
- **Not processed:** the content of any message, world, chat or file. It is encrypted between the launchers
  and the relay cannot read it. No Microsoft or Minecraft account data reaches the relay. The permanent id
  of a user is not in a friend code, and the relay never sees a friend code.
- The relay is a general-purpose iroh relay. The endpoint id it sees is the id of the user's
  endpoint (the permanent id for the main connection, a one-time id for the hello connection of a friend code).

### 3.3 Purpose and legal basis

- Purpose: to connect two users' launchers when a direct connection fails, and to tell a launcher its
  public address so that a direct connection can be made.
- Legal basis: Art. 6(1)(b) GDPR (the user switched the feature on to get exactly this connection
  service), with Art. 6(1)(f) as a fallback (legitimate interest in operating the service and keeping it
  secure). The opt-in dialog is the transparency measure (Art. 13), it is not a consent for the relay.
  **(owner)** confirm the choice.
- No automated decisions, no profiling, no advertising, no sale or sharing of data.

### 3.4 Retention and log policy

| Item | Policy | Basis |
|---|---|---|
| Access log | **None.** The relay writes no access log at its default level | iroh-relay 1.3.0 source (connection-opened lines exist only at debug level) |
| Error log | **Not stored.** The standing deployment discards all relay output (`logging: driver: none`) | `infra/relay/docker-compose.yml` |
| Debug log | Only during a troubleshooting session, with client IPs (the relay cannot truncate them), one file of at most 1 MiB, deleted within **24 hours** by recreating the container | `docker-compose.debug.yml`, RELAY-OPS section 11 |
| Metrics | Aggregate counters (connections, bytes, rate-limited connections), **no IPs and no ids**, reachable on the server's localhost only | `relay.toml`, compose `127.0.0.1` publish |
| Process memory | While a connection is open: IP address and endpoint id. In addition the relay keeps a **set of the endpoint ids seen today** to count unique clients per day. It is cleared at 00:00 UTC and lost on every restart. It holds no IP addresses | `iroh-relay` 1.3.0, `ClientCounter` in `server/client.rs` |
| Certificate volume | Let's Encrypt account and certificates, no user data | `relay-data` volume |
| Server and network logs | Firewall logging is off, no connection-tracking logs, no flow export. Provider-level logging is **(owner)** to check with the provider and to name here | RELAY-OPS section 6 |

Because the relay keeps no record that links a person to a connection, requests for access, correction
or deletion can usually not be answered with data (Art. 11(2) GDPR). The rights under Art. 15 to 21
and the right to complain to a supervisory authority apply. Contact the operator (section 3.1).

### 3.5 Recipients and transfers

- The hosting provider as processor (section 3.1). No other recipients. Own relay in the EU: no transfer to a
  third country.
- n0's public relays are a different controller, see section 4.

### 3.6 Security

TLS to the relay (Let's Encrypt certificate), end-to-end encryption between launchers, per-client
bandwidth limit, no inbound ports other than 80, 443 and 7842 (RELAY-OPS section 4), the
metrics port reachable on localhost only.

### 3.7 Abuse contact

`abuse@<relay-domain>` **(owner: create and monitor the mailbox; the address is a placeholder until the domain
is registered)**.

Reports need the full 64-character PeerId of the offending endpoint. The relay has no log to look
anyone up. See RELAY-OPS section 13 for the steps (block list, bandwidth limit).

## 4. Third-party relays (debug and closed-beta builds only)

- A release build contains only our relay (SPEC 3.2). Debug builds and closed-beta builds
  (feature `beta-relays`) also list n0's public relays: `use1-1.relay.n0.iroh.link`,
  `usw1-1.relay.n0.iroh.link`, `euc1-1.relay.n0.iroh.link`, `aps1-1.relay.n0.iroh.link` (`IROH-NOTES.md`
  section 2.1).
- They are operated by n0 (the developers of iroh), who are the controller for what those servers
  process. They see the same kind of data as in section 3.2. The legal address of the operator, its
  retention policy and where the servers are located were **not verified here (owner)**. Check n0's
  current terms and privacy policy before any beta build ships, and fill in the operator name below.
- Because of that, `friends_enable` requires an explicit, separate consent while such a relay is in the
  map (SPEC 3.2, `acceptThirdPartyRelays`), and the PrivacyNotice names the operator and the hosts. The
  consent also serves as the basis for a possible transfer outside the EU (Art. 49(1)(a)).

## 5. Who learns your address (stated honestly, SPEC 12.1)

- On a **direct** connection both sides learn each other's public IP address and the addresses of their local
  network interfaces (home network, VPN, Docker).
- A friend-code holder cannot learn the inviter's addresses, because the hello connection is relay-only.
- The invitee's main connection may reveal the invitee's addresses to the code owner unless "Immer über
  Relay" is on.
- Anyone who ever knew your permanent id (current or former friends) can tell whether you are online.
- "Immer über Relay" hides your addresses from all peers. The cost is somewhat higher latency, and the
  relay operator then sees who is connected to whom (never the content).

## 6. Other notes, and hand-offs

- **LAN port.** Opening a world to LAN binds the game's port on all network interfaces, as in
  vanilla Minecraft. The tunnel does not change that. Devices in the local network (and anything the router
  forwards) can reach the port, and Mojang's authentication is the only protection. Windows Firewall profiles
  apply. The ShareDialog (F5) says this in short, and this file is the long form.
- **Skins.** The launcher (not the page) fetches a friend's skin from Mojang's sessionserver. That sends the
  friend's Minecraft UUID, and the launcher's IP address, to Mojang. The texture comes from
  `textures.minecraft.net` and is cached on the user's PC. The exact sessionserver host is pinned by R6.
- **Local data.** The identity key is in the OS keychain. Friend records, codes (as hashes), requests and
  the 14-day outbox are in `friends.json` on the user's PC. "Identität zurücksetzen und alle Freunde löschen"
  removes them. Logs never contain IPs, secrets, codes, tokens or hello ids (SPEC 12.1).
- **Hand-off to F3 (not done by D1):** the Settings page should let the user copy the full 64-character
  PeerId, because an abuse report to the relay needs it (section 3.7). The fingerprint alone (16 characters)
  is not enough.

## 7. In-app text drafts

Final wording is reviewed by the owner (SPEC 13.5, item 4). The opt-in bullets are fixed in SPEC 10.9 and are not
repeated here. Key names belong to F3 and are suggestions only. `{operator}`, `{hosts}` and `{relayHost}` are
placeholders filled from `RELAY_MAP`.

### 7.1 PrivacyNotice rows (`components/PrivacyNotice.tsx`)

| Row | Deutsch | English |
|---|---|---|
| Name, own relay (`friendsRelay`) | Pumpkin-Relay | Pumpkin relay |
| Hosts | `relay-eu1.<relay-domain>` | `relay-eu1.<relay-domain>` |
| Purpose | Nur wenn du Freunde einschaltest. Freunde: verschlüsselte Weiterleitung, keine Inhalte. Das Relay leitet verschlüsselte Verbindungen zwischen Launchern weiter und hilft ihnen, sich direkt zu verbinden. Es sieht deine IP-Adresse und die Kennung deines Launchers, solange die Verbindung offen ist, und speichert keine Protokolle. | Only if you turn on Friends. Friends: encrypted forwarding, no content. The relay forwards encrypted connections between launchers and helps them connect directly. While a connection is open it sees your IP address and your launcher's identifier, and it stores no logs. |
| Name, n0 (`friendsRelayN0`, only when the map lists n0) | n0 (Relay-Server für Tests) | n0 (relay servers for testing) |
| Hosts | `use1-1.relay.n0.iroh.link`, `usw1-1.relay.n0.iroh.link`, `euc1-1.relay.n0.iroh.link`, `aps1-1.relay.n0.iroh.link` | same |
| Purpose | Nur in Test-Versionen und nur mit deiner Zustimmung: Freunde: verschlüsselte Weiterleitung, keine Inhalte. Diese Relays betreibt n0, nicht wir. Sie sehen deine IP-Adresse und mit wem du verbunden bist, aber keine Inhalte. Wie lange n0 das speichert, bestimmt n0. | Only in test builds and only with your consent: Friends: encrypted forwarding, no content. n0 runs these relays, not us. They see your IP address and who you are connected to, but no content. How long n0 keeps this is up to n0. |
| Name, Mojang skins (`friendsSkins`) | Mojang (Skins deiner Freunde) | Mojang (your friends' skins) |
| Hosts | `sessionserver.mojang.com` (host to be confirmed by R6), `textures.minecraft.net` | same |
| Purpose | Nur wenn Freunde an ist: Der Launcher fragt mit der Minecraft-UUID eines Freundes dessen Skin bei Mojang ab und speichert das Bild lokal. Mojang sieht dabei die UUID und deine IP-Adresse. | Only if Friends is on: the launcher asks Mojang for a friend's skin using the friend's Minecraft UUID and stores the image locally. Mojang sees the UUID and your IP address. |

### 7.2 Third-party relay consent checkbox (opt-in dialog, SPEC 10.9)

| Deutsch | English |
|---|---|
| Ich bin einverstanden, dass {operator} ({hosts}) als Relay genutzt wird. Der Betreiber sieht meine IP-Adresse und mit wem ich verbunden bin, aber keine Inhalte. Das gilt nur für diese Test-Version. | I agree that {operator} ({hosts}) is used as a relay. The operator sees my IP address and who I am connected to, but no content. This applies to this test build only. |

### 7.3 Settings hints

| Where | Deutsch | English |
|---|---|---|
| "Verbunden über {relayHost}" tooltip | Das Relay leitet verschlüsselt weiter und speichert keine Protokolle. | The relay forwards encrypted data and stores no logs. |
| "Immer über Relay" hint (extends SPEC 10.8) | Freunde sehen deine IP-Adressen nicht. Etwas höhere Latenz. Der Relay-Betreiber sieht, wer mit wem verbunden ist, aber keine Inhalte. | Friends do not see your IP addresses. Slightly higher latency. The relay operator sees who is connected to whom, but no content. |
| ShareDialog LAN note (F5) | Beim Öffnen für LAN lauscht Minecraft auf allen Netzwerkschnittstellen, wie im normalen Spiel. Geräte in deinem Netzwerk können den Port erreichen; geschützt ist er nur durch die Mojang-Anmeldung. | Opening to LAN makes Minecraft listen on all network interfaces, as in normal play. Devices on your network can reach the port, and only Mojang's login protects it. |

### 7.4 Longer relay information (website or README)

**Deutsch.** Der Pumpkin-Relay ist ein Server, der verschlüsselte Verbindungen zwischen Launchern weiterleitet, wenn
sich zwei Computer nicht direkt erreichen können, und der Launchern ihre öffentliche Adresse mitteilt. Er wird von
**(owner: Name, Anschrift)** betrieben und läuft bei **(owner: Hoster, EU)**. Er verarbeitet, solange eine
Verbindung besteht, deine IP-Adresse, die Kennung deines Launchers und die Information, mit wem sie verbunden ist.
Inhalte kann er nicht lesen. Der Relay führt keine Zugriffsprotokolle und speichert keine Fehlerprotokolle. Die Kennungen
der heute gesehenen Verbindungen liegen bis 00:00 UTC im Arbeitsspeicher, nur zum Zählen. Rechtsgrundlage ist Art. 6
Abs. 1 lit. b, hilfsweise lit. f DSGVO. Weil nichts gespeichert wird, können wir einzelnen Personen meist keine Daten
zuordnen (Art. 11 DSGVO). Du hast die Rechte nach Art. 15 bis 21 DSGVO und kannst dich bei einer Aufsichtsbehörde
beschweren. Datenschutzfragen: `privacy@<relay-domain>`. Missbrauch melden: `abuse@<relay-domain>` (bitte mit der
vollständigen PeerId).

**English.** The Pumpkin relay is a server that forwards encrypted connections between launchers when two computers
cannot reach each other directly, and that tells launchers their public address. It is operated by **(owner: name,
address)** and hosted at **(owner: provider, EU)**. While a connection exists it processes your IP address, the
your launcher's identifier and the information of who it is connected to. It cannot read any content. The relay
keeps no access log and stores no error log. The identifiers of the connections seen today are held in memory until
00:00 UTC, only to count them. The legal basis is Art. 6(1)(b), alternatively (f) GDPR. Because nothing is stored, we
usually cannot link data to a person (Art. 11 GDPR). You have the rights under Art. 15 to 21 GDPR and can complain to a
supervisory authority. Privacy questions: `privacy@<relay-domain>`. Report abuse: `abuse@<relay-domain>` (please include
the full PeerId).

## 8. Mojang and Microsoft compliance checklist (SPEC Appendix C)

Copied unticked from Appendix C. I1 ticks it in `VERIFICATION.md`. The right column says where each item is
met, so I1 knows what to check. The Usage Guidelines and the approval scope are not checked here.

| Done | Item | Where it is met or checked |
|---|---|---|
| [ ] | The launcher About page and the mod description carry "NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT." | About page (`AboutTab.tsx`): no such line exists in `src` or the README today (searched); needed before release. Mod: Modrinth description and `mod/README.md` (M1) |
| [ ] | No Minecraft logo or Mojang branding in the friends UI or the mod. The name "Pumpkin Friends" does not suggest officialness. | Review of F2 to F5 and M1 assets |
| [ ] | Free, with no paid perks or gating. No game files are distributed between peers. Each client downloads from Mojang and Modrinth only. | SPEC 1.2 (no downloads from friends), R6 |
| [ ] | Online-mode only. Offline accounts are refused before launch (E8a, plus the R3 unit test), and the host's game refuses them at login (E8b, with the recorded vanilla message). | E8a and E8b in `VERIFICATION.md` |
| [ ] | Child-account behaviour recorded (E13). The feature does not bypass Xbox or Mojang multiplayer restrictions (it uses the vanilla join path). | E13 |
| [ ] | The Usage Guidelines were re-read at release time (date recorded). | Owner, date in `VERIFICATION.md` |
| [ ] | The owner confirmed that the Microsoft/Mojang app approval covers sharing player names and UUIDs between users (G4). | Owner, G4 (see `docs/ACCOUNT-SETUP.md`) |
| [ ] | The Modrinth API is used with the launcher User-Agent and within its rate limits. | R6 mod install and lookup code, existing Modrinth client |
