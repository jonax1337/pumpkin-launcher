import { errors as deErrors } from "../de/errors.ts";
import { errorsApp } from "./errors.app.ts";
import { errorsGame } from "./errors.game.ts";
import { errorsModrinth } from "./errors.modrinth.ts";
import { errorsPacks } from "./errors.packs.ts";
import { errorsProviders } from "./errors.providers.ts";

/** Englische Fehlermeldungen des Backends; der Typ erzwingt dieselben Codes wie im deutschen Wörterbuch. */
export const errors: typeof deErrors = {
  "errors.withDetails": "{message} – Details: {details}",
  "errors.io.storageFull": "There is not enough free disk space. Free up some space and try again.",
  "errors.io.fileInUse": "A file is in use by another program. Close it (e.g. Minecraft) and try again.",
  "errors.io.permissionDenied": "Access to a file was denied. Check whether another program is locking or protecting it.",
  "errors.io.notFound": "A required file or folder is missing.",
  "errors.io.timedOut": "The operation took too long. Try again.",
  "errors.io.other": "An error occurred while reading or writing a file.",
  "errors.http.gone": "The file is no longer available on the server.",
  "errors.http.forbidden": "The server denied access.",
  "errors.http.tooManyRequests": "Too many requests in a short time. Wait a moment and try again.",
  "errors.http.serverError": "The server is having problems right now. Try again later.",
  "errors.http.rejected": "The server rejected the request.",
  "errors.http.timeout": "The server is not responding in time. Check your connection and try again.",
  "errors.http.offline": "No internet connection. Check your connection and try again.",
  "errors.http.unreadable": "The server's response was incomplete or unreadable.",
  "errors.http.interrupted": "The connection to the server was interrupted. Try again.",
  "errors.json": "The data could not be read",
  "errors.store.newerEntry": "An entry with this ID comes from a newer version of the launcher and is left unchanged. Update the launcher to edit it.",
  "errors.zip": "The archive is damaged or not a valid package",
  "errors.nbt": "A game file is damaged or has an unknown format",
  "errors.download": "A download failed",
  "errors.upload": "The upload did not work",
  "errors.tauri": "Internal app error",
  "errors.keyring": "The system's password store is not reachable.",
  "errors.keyring.linux": "The system's password store is not reachable. The launcher needs a Secret Service provider such as GNOME Keyring or KWallet there: install, start and unlock it.",
  "errors.trash": "The file could not be moved to the trash",
  "errors.sqlite": "Another launcher's database is not readable",
  "errors.cancelled": "Operation cancelled",
  "errors.notInstalled": "{what} is not installed",
  "errors.operationRunning": "An installation or change is already in progress",
  "errors.instance.stillRunning": "The instance is still running",
  "errors.instance.alreadyRunning": "The instance is already running",
  "errors.auth.cancelled": "Sign-in cancelled.",
  "errors.auth.expired": "The sign-in has expired. Please start it again.",
  "errors.auth.notApproved": "Microsoft has not yet approved this launcher for Minecraft. It's not you or your account: this build's Microsoft app has no approval yet. The official Pumpkin Launcher is approved, so this usually means a fork or a self-built copy.",
  "errors.auth.tooManyAttempts": "Too many sign-in attempts in a short time. Wait a few minutes and try again.",
  "errors.auth.minecraftFailed": "Signing in to Minecraft failed (error {status}).",
  "errors.export.chooseTarget": "Please choose where to save the .mrpack file",
  "errors.export.loaderVersionMissing": "The instance has no loader version yet: please start it once first",
  ...errorsApp,
  ...errorsGame,
  ...errorsModrinth,
  ...errorsPacks,
  ...errorsProviders,
};
