import type { Dict } from "../types.ts";
import { errorsApp } from "./errors.app.ts";
import { errorsFriends } from "./errors.friends.ts";
import { errorsGame } from "./errors.game.ts";
import { errorsModrinth } from "./errors.modrinth.ts";
import { errorsPacks } from "./errors.packs.ts";
import { errorsProviders } from "./errors.providers.ts";

/**
 * Fehlermeldungen des Backends nach Fehlercode (`coded!` in `src-tauri/src/error/text.rs`).
 * Das Backend liest die deutschen Texte beim Bauen mit (auch die der Gruppendateien): Werte nur als
 * "…"-Zeichenkette direkt nach dem Schlüssel, keine Verkettung. Ein Code ohne Eintrag kompiliert im Backend nicht.
 */
const errorsCore = {
  "errors.withDetails": "{message} – Details: {details}",
  "errors.io.storageFull": "Auf der Festplatte ist nicht genug Platz frei. Schaffe Platz und versuch es erneut.",
  "errors.io.fileInUse": "Eine Datei wird gerade von einem anderen Programm benutzt. Schließe es (z. B. Minecraft) und versuch es erneut.",
  "errors.io.permissionDenied": "Zugriff auf eine Datei wurde verweigert. Prüfe, ob ein anderes Programm sie sperrt oder schützt.",
  "errors.io.notFound": "Eine benötigte Datei oder ein Ordner fehlt.",
  "errors.io.timedOut": "Der Vorgang hat zu lange gedauert. Versuch es erneut.",
  "errors.io.other": "Beim Lesen oder Schreiben einer Datei ist ein Fehler aufgetreten.",
  "errors.http.gone": "Die Datei gibt es auf dem Server nicht (mehr).",
  "errors.http.forbidden": "Der Server hat den Zugriff verweigert.",
  "errors.http.tooManyRequests": "Zu viele Anfragen in kurzer Zeit. Warte einen Moment und versuch es erneut.",
  "errors.http.serverError": "Der Server hat gerade Probleme. Versuch es später erneut.",
  "errors.http.rejected": "Der Server hat die Anfrage abgelehnt.",
  "errors.http.timeout": "Der Server antwortet nicht rechtzeitig. Prüfe deine Verbindung und versuch es erneut.",
  "errors.http.offline": "Keine Verbindung zum Internet. Prüfe deine Verbindung und versuch es erneut.",
  "errors.http.unreadable": "Die Antwort des Servers war unvollständig oder unlesbar.",
  "errors.http.interrupted": "Die Verbindung zum Server ist abgebrochen. Versuch es erneut.",
  "errors.json": "Die Daten konnten nicht gelesen werden",
  "errors.store.newerEntry": "Ein Eintrag mit dieser ID stammt aus einer neueren Version des Launchers und bleibt unverändert. Aktualisiere den Launcher, um ihn zu bearbeiten.",
  "errors.zip": "Das Archiv ist beschädigt oder kein gültiges Paket",
  "errors.nbt": "Eine Spieldatei ist beschädigt oder hat ein unbekanntes Format",
  "errors.download": "Ein Download ist fehlgeschlagen",
  "errors.upload": "Das Hochladen hat nicht geklappt",
  "errors.tauri": "Interner Fehler der App",
  "errors.keyring": "Der Passwortspeicher des Systems ist nicht erreichbar.",
  "errors.keyring.linux": "Der Passwortspeicher des Systems ist nicht erreichbar. Der Launcher braucht dort einen Secret-Service-Dienst wie GNOME Keyring oder KWallet: installieren, starten und entsperren.",
  "errors.trash": "Die Datei konnte nicht in den Papierkorb verschoben werden",
  "errors.sqlite": "Die Datenbank eines anderen Launchers ist nicht lesbar",
  "errors.cancelled": "Vorgang abgebrochen",
  "errors.notInstalled": "{what} ist nicht installiert",
  "errors.operationRunning": "Eine Installation/Änderung läuft bereits",
  "errors.instance.stillRunning": "Instanz läuft noch",
  "errors.instance.alreadyRunning": "Instanz läuft bereits",
  "errors.auth.cancelled": "Anmeldung abgebrochen.",
  "errors.auth.expired": "Die Anmeldung ist abgelaufen. Starte sie bitte neu.",
  "errors.auth.notApproved": "Microsoft hat diesen Launcher noch nicht für Minecraft freigeschaltet. Das liegt nicht an dir und nicht an deinem Konto: Für die Microsoft-App dieses Builds fehlt die Freigabe. Der offizielle Pumpkin Launcher ist freigegeben, hier handelt es sich meist um einen Fork oder eine selbst gebaute Kopie.",
  "errors.auth.tooManyAttempts": "Zu viele Anmeldeversuche in kurzer Zeit. Warte ein paar Minuten und versuch es erneut.",
  "errors.auth.minecraftFailed": "Die Anmeldung bei Minecraft ist fehlgeschlagen (Fehler {status}).",
  "errors.export.chooseTarget": "Bitte einen Speicherort für die .mrpack-Datei wählen",
  "errors.export.loaderVersionMissing": "Instanz ohne Loader-Version: bitte erst einmal starten",
} satisfies Dict;

/** Alle Fehlermeldungen; jede Gruppe pflegt ihre Codes in der eigenen Datei `errors.<gruppe>.ts`. */
export const errors = {
  ...errorsCore,
  ...errorsApp,
  ...errorsFriends,
  ...errorsGame,
  ...errorsModrinth,
  ...errorsPacks,
  ...errorsProviders,
} satisfies Dict;
