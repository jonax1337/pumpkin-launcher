import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import {
  allCapabilities, eventSubscriptions, type Backend, type BackendEvents, type LauncherWindowAction, type SearchOptions,
} from "./backend";
import { toBackendError } from "./errors";

/** Fehler der Tauri-Aufrufe kommen als `{ code, message }` (oder Plugin-String bzw. -Objekt); hier werden sie zu `BackendError`. */
const rethrowAsError = (err: unknown): never => {
  throw toBackendError(err);
};

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    return rethrowAsError(err);
  }
}

/** Die Command-Argumente der Suche; das Backend nennt Typ, Minecraft-Version und Loader ausgeschrieben. */
const searchArgs = ({ query, type, mc, loader, offset, index }: SearchOptions) =>
  ({ query, projectType: type, minecraftVersion: mc, loader, offset, index });

/** Zurück aus dem Minimieren: Fenster zeigen und nach vorn holen. */
async function restoreLauncher(win: ReturnType<typeof getCurrentWindow>) {
  await win.unminimize();
  await win.setFocus();
}

const setLauncherWindow = (action: LauncherWindowAction) => {
  const win = getCurrentWindow();
  const done = action === "minimize" ? win.minimize() : action === "restore" ? restoreLauncher(win) : win.close();
  return done.catch(rethrowAsError);
};

const on = <E extends keyof BackendEvents>(event: E, cb: (payload: BackendEvents[E]) => void) =>
  listen<BackendEvents[E]>(event, (e) => cb(e.payload));

/** Die Tauri-Commands von `src-tauri`; Namen und Argumente sind der Vertrag mit dem Rust-Backend. */
export function createTauriBackend(): Backend {
  return {
    capabilities: allCapabilities(true),
    ...eventSubscriptions(on),

    modrinthSearch: (options) => call("modrinth_search", { ...searchArgs(options), category: options.category }),
    modrinthProject: (projectId) => call("modrinth_project", { projectId }),
    modrinthProjects: (projectIds) => call("modrinth_projects", { projectIds }),
    modrinthVersions: (projectId, minecraftVersion, loader) => call("modrinth_versions", { projectId, minecraftVersion, loader }),
    modrinthInstallMod: (instanceId, versionId, operationId) => call("modrinth_install_mod", { instanceId, versionId, operationId }),
    modrinthCheckUpdates: (instanceId) => call("modrinth_check_updates", { instanceId }),
    modrinthUpdateMods: (instanceId, modIds, operationId) => call("modrinth_update_mods", { instanceId, modIds, operationId }),
    modrinthSwitchVersion: (instanceId, modId, versionId, operationId) =>
      call("modrinth_switch_version", { instanceId, modId, versionId, operationId }),
    contentAnalysis: (instanceId) => call("instance_content_analysis", { instanceId }),
    packSelection: (instanceId) => call("instance_pack_selection", { instanceId }),
    setResourcePacks: (instanceId, packs) => call("instance_set_resource_packs", { instanceId, packs }),
    setShaderPack: (instanceId, pack) => call("instance_set_shader_pack", { instanceId, pack }),
    modrinthIdentify: (instanceId, modIds) => call("modrinth_identify", { instanceId, modIds }),
    checkLocalFiles: (instanceId, paths) => call("instance_check_files", { instanceId, paths }),
    addLocalFiles: (instanceId, files, operationId) => call("instance_add_files", { instanceId, files, operationId }),
    modrinthInstallPack: (versionId, name, operationId) => call("modrinth_install_pack", { versionId, name, operationId }),
    modrinthImportPack: (path, name, operationId) => call("modrinth_import_pack", { path, name, operationId }),
    curseforgeImportPack: (path, name, operationId) => call("curseforge_import_pack", { path, name, operationId }),
    providerSearch: (source, options) => call("provider_search", { source, ...searchArgs(options) }),
    providerProject: (source, projectId) => call("provider_project", { source, projectId }),
    providerVersions: (source, projectId, { mc, loader }) =>
      call("provider_versions", { source, projectId, minecraftVersion: mc, loader }),
    providerInstallPack: (source, { projectId, versionId, name }, operationId) =>
      call("provider_install_pack", { source, projectId, versionId, name, operationId }),
    providerInstallMod: (source, { instanceId, projectId, versionId }, operationId) =>
      call("provider_install_mod", { source, instanceId, projectId, versionId, operationId }),
    curseforgeAdoptDownload: (instanceId, { projectId, fileId, fileName }) =>
      call("curseforge_adopt_download", { instanceId, projectId, fileId, fileName }),
    openExternal: (url) => openUrl(url).catch(rethrowAsError),

    listInstances: () => call("list_instances"),
    getInstance: (id) => call("get_instance", { id }),
    createInstance: (input) => call("create_instance", { input }),
    updateInstance: (instance) => call("update_instance", { instance }),
    setInstanceGroup: (instanceId, group) => call("instance_set_group", { instanceId, group }),
    setInstanceIcon: (instanceId, icon) => call("instance_set_icon", { instanceId, icon }),
    setInstanceScene: (instanceId, scene) => call("instance_set_scene", { instanceId, scene }),
    deleteInstance: (id) => call("delete_instance", { id }),
    duplicateInstance: (instanceId, operationId) => call("instance_duplicate", { instanceId, operationId }),
    exportEntries: (instanceId) => call("instance_export_entries", { instanceId }),
    exportSummary: (instanceId, include) => call("instance_export_summary", { instanceId, include }),
    exportTargets: (folder, fileNames) => call("instance_export_targets", { folder, fileNames }),
    exportInstance: (instanceId, request, path, operationId) => call("instance_export", { instanceId, request, path, operationId }),
    packChangelog: (instanceId, versionId) => call("pack_changelog", { instanceId, versionId }),
    packUpdate: (instanceId, target, operationId) => call("pack_update", { instanceId, target, operationId }),
    migrateCheck: (instanceId, target) => call("instance_migrate_check", { instanceId, target }),
    migrateInstance: (instanceId, target, operationId) => call("instance_migrate", { instanceId, target, operationId }),
    duplicateMigrate: (instanceId, target, operationId) => call("instance_duplicate_migrate", { instanceId, target, operationId }),
    pickPaths: async (options) => {
      const picked = await openDialog(options).catch(rethrowAsError);
      return picked === null ? [] : [picked].flat();
    },
    pickSavePath: (options) => saveDialog(options).catch(rethrowAsError),
    revealPath: (path) => revealItemInDir(path).catch(rethrowAsError),

    importDetect: (folder) => call("import_detect", { folder }),
    importInstance: (request, operationId) => call("instance_import", { request, operationId }),

    templateSave: (instanceId, name) => call("template_save", { instanceId, name }),
    templateList: () => call("template_list"),
    templateDelete: (id) => call("template_delete", { id }),
    templateCreateInstance: (templateId, name, operationId) => call("template_create_instance", { templateId, name, operationId }),
    templateExport: (templateId, path) => call("template_export", { id: templateId, path }),
    templateImport: (path) => call("template_import", { path }),

    takeOpenedPack: () => call("pack_open_take"),

    versionsList: () => call("versions_list"),
    loaderVersions: (loader, mcVersion) => call("loader_versions", { loader, mcVersion }),
    installCancel: (instanceId) => call("instance_install_cancel", { instanceId }),
    packInstallCancel: (operationId) => call("pack_install_cancel", { operationId }),
    systemMemoryMb: () => call("system_memory_mb"),
    instanceStatus: (instanceId) => call("instance_status", { instanceId }),
    instanceDir: (instanceId) => call("instance_dir", { instanceId }),
    installInstance: (instanceId) => call("instance_install", { instanceId }),
    launchInstance: (instanceId, options) => call("instance_launch", { instanceId, options }),
    killInstance: (instanceId) => call("instance_kill", { instanceId }),

    msLoginStart: (method) => call("ms_login_start", { method: method ?? null }),
    msLoginFinish: () => call("ms_login_finish"),
    msLoginCancel: () => call("ms_login_cancel"),
    msAccounts: () => call("ms_accounts"),
    offlineAllowed: () => call("offline_allowed"),
    msAccountRemove: (id) => call("ms_account_remove", { id }),
    shareLog: (instanceId, kind) => call("log_share", { instanceId, kind }),
    debugInfo: ({ defaultMemoryMb, javaPath, instanceId }) => call("debug_info", { defaultMemoryMb, javaPath, instanceId }),
    logSessions: (instanceId) => call("log_sessions", { instanceId }),
    logSessionRead: (instanceId, sessionId) => call("log_session_read", { instanceId, sessionId }),

    storageOverview: () => call("storage_overview"),
    storageClearCache: () => call("storage_clear_cache"),
    storageOpenDir: () => call("storage_open_dir"),
    detectJava: () => call("java_detect"),
    setLauncherWindow,

    skinProfile: (accountId) => call("skin_profile", { accountId }),
    skinLibrary: () => call("skin_library"),
    skinTexture: (id) => call("skin_texture", { id }),
    skinAdd: (path) => call("skin_add", { path }),
    skinAddPlayer: (name) => call("skin_add_player", { name }),
    skinUpdate: (id, name, variant) => call("skin_update", { id, name, variant }),
    skinDelete: (id) => call("skin_delete", { id }),
    skinSaveActive: (accountId, name) => call("skin_save_active", { accountId, name }),
    skinUpload: (accountId, skinId) => call("skin_upload", { accountId, skinId }),
    skinReset: (accountId) => call("skin_reset", { accountId }),
    skinCape: (accountId, capeId) => call("skin_cape", { accountId, capeId }),

    worldList: (instanceId) => call("world_list", { instanceId }),
    worldBackup: (instanceId, worldId, operationId) => call("world_backup", { instanceId, worldId, operationId }),
    worldBackups: (instanceId) => call("world_backups", { instanceId }),
    worldRestore: (instanceId, backupId) => call("world_restore", { instanceId, backupId }),
    worldBackupDelete: (instanceId, backupId) => call("world_backup_delete", { instanceId, backupId }),
    worldBackupsExport: (instanceId, directory) => call("world_backups_export", { instanceId, path: directory }),
    worldImport: (instanceId, path, operationId) => call("world_import", { instanceId, path, operationId }),
    worldDelete: (instanceId, worldId, operationId) => call("world_delete", { instanceId, worldId, operationId }),
    worldQuickPlaySupported: (instanceId) => call("world_quick_play_supported", { instanceId }),
    datapackList: (instanceId, worldId) => call("datapack_list", { instanceId, worldId }),
    datapackAdd: (instanceId, worldId, paths) => call("datapack_add", { instanceId, worldId, paths }),
    datapackInstall: (instanceId, worldId, versionId, operationId) =>
      call("datapack_install", { instanceId, worldId, versionId, operationId }),
    datapackRemove: (instanceId, worldId, packId) => call("datapack_remove", { instanceId, worldId, packId }),
    serverList: (instanceId) => call("server_list", { instanceId }),
    serverSave: (instanceId, index, server) => call("server_save", { instanceId, index, server }),
    serverRemove: (instanceId, index) => call("server_remove", { instanceId, index }),
    serverPing: (instanceId, address) => call("server_ping", { instanceId, address }),
    screenshots: (instanceId) => call("screenshot_list", { instanceId }),
    screenshotDelete: (instanceId, fileName) => call("screenshot_delete", { instanceId, fileName }),
    screenshotRead: (instanceId, fileName) => call("screenshot_read", { instanceId, fileName }),
    screenshotSrc: (shot) => convertFileSrc(shot.path),

    openPath: (path) => openPath(path).catch(rethrowAsError),

    checkAppUpdate: () => check().catch(rethrowAsError),
    restartApp: () => relaunch().catch(rethrowAsError),

    friendsState: () => call("friends_state"),
    friendsEnable: (input) => call("friends_enable", { input }),
    friendsDisable: () => call("friends_disable"),
    friendsUpdateSettings: (settings) => call("friends_update_settings", { settings }),
    friendsRotateIdentity: () => call("friends_rotate_identity"),
    friendsReset: () => call("friends_reset"),
    friendsList: () => call("friends_list"),
    friendRequests: () => call("friend_requests"),
    friendCodeCreate: () => call("friend_code_create"),
    friendCodes: () => call("friend_codes"),
    friendCodeRevoke: (codeId) => call("friend_code_revoke", { codeId }),
    friendAdd: (code) => call("friend_add", { code }),
    friendAddByName: (name) => call("friend_add_by_name", { name }),
    friendRequestAnswer: (requestId, accept) => call("friend_request_answer", { requestId, accept }),
    friendRequestCancel: (requestId) => call("friend_request_cancel", { requestId }),
    friendRename: (friendId, alias) => call("friend_rename", { friendId, alias }),
    friendAcknowledge: (friendId) => call("friend_acknowledge", { friendId }),
    friendRemove: (friendId) => call("friend_remove", { friendId }),
    friendBlock: (peerId) => call("friend_block", { peerId }),
    friendUnblock: (peerId) => call("friend_unblock", { peerId }),
    friendsBlocked: () => call("friends_blocked"),
    friendsRetryNow: () => call("friends_retry_now"),
    friendSkin: (friendId) => call("friend_skin", { friendId }),

    lanStatus: (instanceId) => call("lan_status", { instanceId }),
    hostSessions: () => call("host_sessions"),
    hostStart: (instanceId, port, showWorldName) => call("host_start", { instanceId, port, showWorldName }),
    hostInvite: (sessionId, friendIds) => call("host_invite", { sessionId, friendIds }),
    hostKick: (sessionId, friendId) => call("host_kick", { sessionId, friendId }),
    hostStop: (sessionId) => call("host_stop", { sessionId }),
    invitesList: () => call("invites_list"),
    inviteDecline: (inviteId) => call("invite_decline", { inviteId }),
    invitePlan: (inviteId) => call("invite_plan", { inviteId }),
    inviteJoin: (inviteId, instanceId) => call("invite_join", { inviteId, instanceId }),
    joinLeave: (joinId) => call("join_leave", { joinId }),
    friendsIngameStatus: (instanceId) => call("friends_ingame_status", { instanceId }),
    friendsIngameSetEnabled: (instanceId, enabled) => call("friends_ingame_set_enabled", { instanceId, enabled }),
    friendsIngameRetry: (instanceId) => call("friends_ingame_retry", { instanceId }),
    friendsModConfirm: (requestId, allow) => call("friends_mod_confirm", { requestId, allow }),
    friendsModActivity: () => call("friends_mod_activity"),
  };
}
