import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { allCapabilities, eventSubscriptions, type Backend, type BackendEvents } from "./backend";
import { errorMessage } from "./errors";

/** Fehler der Tauri-Aufrufe kommen als string (oder Plugin-Fehlerobjekt); hier werden sie zu `Error`, die Ursache bleibt in `cause`. */
const rethrowAsError = (err: unknown): never => {
  throw new Error(errorMessage(err), { cause: err });
};

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    return rethrowAsError(err);
  }
}

const on = <E extends keyof BackendEvents>(event: E, cb: (payload: BackendEvents[E]) => void) =>
  listen<BackendEvents[E]>(event, (e) => cb(e.payload));

/** Die Tauri-Commands von `src-tauri`; Namen und Argumente sind der Vertrag mit dem Rust-Backend. */
export function createTauriBackend(): Backend {
  return {
    capabilities: allCapabilities(true),
    ...eventSubscriptions(on),

    modrinthSearch: (query, projectType, minecraftVersion, loader, offset = 0, index = null) =>
      call("modrinth_search", { query, projectType, minecraftVersion, loader, offset, index }),
    modrinthProject: (projectId) => call("modrinth_project", { projectId }),
    modrinthProjects: (projectIds) => call("modrinth_projects", { projectIds }),
    modrinthVersions: (projectId, minecraftVersion, loader) => call("modrinth_versions", { projectId, minecraftVersion, loader }),
    modrinthInstallMod: (instanceId, versionId, operationId) => call("modrinth_install_mod", { instanceId, versionId, operationId }),
    modrinthCheckUpdates: (instanceId) => call("modrinth_check_updates", { instanceId }),
    modrinthUpdateMods: (instanceId, modIds, operationId) => call("modrinth_update_mods", { instanceId, modIds, operationId }),
    modrinthIdentify: (instanceId, modIds) => call("modrinth_identify", { instanceId, modIds }),
    checkLocalFiles: (instanceId, paths) => call("instance_check_files", { instanceId, paths }),
    addLocalFiles: (instanceId, files, operationId) => call("instance_add_files", { instanceId, files, operationId }),
    modrinthInstallPack: (versionId, name, operationId) => call("modrinth_install_pack", { versionId, name, operationId }),
    modrinthImportPack: (path, name, operationId) => call("modrinth_import_pack", { path, name, operationId }),
    providerSearch: (source, query, projectType, minecraftVersion, loader, offset = 0, index = null) =>
      call("provider_search", { source, query, projectType, minecraftVersion, loader, offset, index }),
    providerProject: (source, projectId) => call("provider_project", { source, projectId }),
    providerVersions: (source, projectId, minecraftVersion = null, loader = null) =>
      call("provider_versions", { source, projectId, minecraftVersion, loader }),
    providerInstallPack: (source, projectId, versionId, name, operationId) =>
      call("provider_install_pack", { source, projectId, versionId, name, operationId }),
    providerInstallMod: (source, instanceId, projectId, versionId, operationId) =>
      call("provider_install_mod", { source, instanceId, projectId, versionId, operationId }),
    curseforgeAdoptDownload: (instanceId, projectId, fileId, fileName) =>
      call("curseforge_adopt_download", { instanceId, projectId, fileId, fileName }),
    openExternal: (url) => openUrl(url).catch(rethrowAsError),

    listInstances: () => call("list_instances"),
    getInstance: (id) => call("get_instance", { id }),
    createInstance: (input) => call("create_instance", { input }),
    updateInstance: (instance) => call("update_instance", { instance }),
    setInstanceGroup: (instanceId, group) => call("instance_set_group", { instanceId, group }),
    deleteInstance: (id) => call("delete_instance", { id }),
    duplicateInstance: (instanceId, operationId) => call("instance_duplicate", { instanceId, operationId }),
    exportEntries: (instanceId) => call("instance_export_entries", { instanceId }),
    exportInstance: (instanceId, include, path, operationId) => call("instance_export", { instanceId, include, path, operationId }),
    pickPaths: async (options) => {
      const picked = await openDialog(options).catch(rethrowAsError);
      return picked === null ? [] : [picked].flat();
    },
    revealPath: (path) => revealItemInDir(path).catch(rethrowAsError),

    importDetect: (folder) => call("import_detect", { folder }),
    importInstance: (source, operationId) => call("instance_import", { source, operationId }),

    templateSave: (instanceId, name) => call("template_save", { instanceId, name }),
    templateList: () => call("template_list"),
    templateDelete: (id) => call("template_delete", { id }),
    templateCreateInstance: (templateId, name, operationId) => call("template_create_instance", { templateId, name, operationId }),

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
    debugInfo: (defaultMemoryMb) => call("debug_info", { defaultMemoryMb }),

    skinProfile: (accountId) => call("skin_profile", { accountId }),
    skinLibrary: () => call("skin_library"),
    skinTexture: (id) => call("skin_texture", { id }),
    skinAdd: (path) => call("skin_add", { path }),
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
    screenshots: (instanceId) => call("screenshot_list", { instanceId }),
    screenshotDelete: (instanceId, fileName) => call("screenshot_delete", { instanceId, fileName }),
    screenshotSrc: (shot) => convertFileSrc(shot.path),

    openPath: (path) => openPath(path).catch(rethrowAsError),

    checkAppUpdate: () => check().catch(rethrowAsError),
    restartApp: () => relaunch().catch(rethrowAsError),
  };
}
