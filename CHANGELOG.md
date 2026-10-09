# Changelog

Last updated: 2026-10-08.

For installation and a first game, start with the [launcher guide](README.md#download-and-install).

## Unreleased

### Interface kit rebuilt

- The interface kit in `src/ui` was rebuilt: the Pixelkino look stays in CSS
  (`look.css`, `look/*.css`), layout is Tailwind utilities in the components
  and can be overridden per call with `className`. The whole app was migrated
  to it and the old component and stylesheet set was removed. Covers buttons,
  chips, tabs, forms, lists, cards, progress, panels, dialogs, menus, tooltips
  and toasts plus the page frame. Preview at `/_kit` (development only).
- Toasts and empty states no longer carry the Buddy mascot; Buddy is placed
  explicitly where it is wanted.

### Interface polish

- Menus and popovers stay on screen and scroll in small windows; the settings
  and news side rail no longer shifts below 960 px.
- Buttons follow one size rule (page header 40 px, section and row actions
  32 px); unselected checkboxes and radios are clearly visible; selected rows
  share one selection colour.
- The update badge looks the same on Home, in the Library and in the instance
  header.
- Removed the "Starter picks" switch from Discover.
- Discover keeps its search bar in view, Friends moves in-game activity into a
  collapsible section, and the Home page fits the 800×600 minimum window.
  Hero scenes keep their soft gradients.
- Fixes: wrong confirm label when resetting a skin, "Modpack version" header on
  mod pages, log lines hidden under the warning bar, ambiguous version chips in
  the instance header, and hero text legibility on bright scenes.

### Inventar interface

- The whole launcher now uses the "Inventar" look, inspired by Minecraft's own
  menus: recessed slots for fields, selections and tracks, raised stone plates
  for buttons, hard text shadows, creative-inventory tabs, purple item-tooltip
  frames for menus, popovers and tooltips, XP-bar progress and sliders, and
  advancement-style toasts. Keyboard focus is a double ring that never relies on
  colour alone; the pixel size setting (small, medium, large) still works.
- Chosen cards and tiles are framed in the accent colour, and chosen library rows
  get a hotbar-style notch at the left.
- New 8×8 pixel icon set with a second, half-transparent tone. Icons keep whole
  pixels at every size and display scaling.
- New details: key caps in the command palette (an entry's own shortcut, Enter
  on the selected row), an account menu that opens with the active
  account's avatar, name and type, a rotating skin figure on a stepped podium
  with an "Active" chip on the skin in use, a legend under the storage bar in
  Settings, a status plate for the connection to the Friends relay, and the
  shortcuts overview in two columns with a key cap per key.

### Command palette

- Press Ctrl+K (Cmd+K on macOS) anywhere to open a command palette: type to
  filter, Up/Down/Home/End to select, Enter to run, Esc to close. It does not
  open over another dialog, and the shortcut is listed in the `?` overview.
- It finds instances ("Play", "Stop", "Open", and "Play last" into the world or
  server of the last Quick Play), every page and Settings tab, and actions: new
  instance, import from another launcher, check for launcher updates, open the
  data and instances folders, animated scenes on/off and text size.
- "Play" and "Stop" use the same paths as the Play button, including the stop
  confirmation; entries that cannot run right now are dimmed with the reason.
- "Search Discover for ..." opens Discover with the typed text in its search
  field (`/discover?suche=...`).
- Matching ignores case and accents and ranks prefixes before word starts before
  scattered letters. With an empty field, the last five commands you ran come
  first; they are remembered on this device.

### Crash assistant

- After a crash, the Log tab now explains what went wrong and offers a fix to
  apply with one click, instead of only naming up to three suspect mods. It
  reads the crash report; without one, it reads the log of the last session of
  that launch. Each finding shows a short excerpt from the report.
- It recognizes a full Java heap (raise memory to double, rounded up to 512 MB
  steps and capped at what the PC allows; at the cap it only explains), a Java
  version that is too old (shows the Java version that the class file version
  needs; can remove a custom Java path), a missing mod dependency (Fabric,
  Quilt, Forge and NeoForge; searches for it in Add content and can switch off
  the mod that needs it), a failed Mixin and duplicate mods (switch the mod off),
  a missing OpenGL driver (links to Minecraft Help for Windows messages), a busy
  network port (explanation only) and damaged or missing game files (repair).
- If none of these matches, the suspect mods from the report are listed, each
  with a switch-off button, as before. The crash notification keeps naming them.
- A game that dies before it writes a log or report (for example a Java that is
  too old for the game) leaves nothing to analyze; the assistant then stays out of
  the way.
- New command `crash_diagnose` (instance ID and the launcher's default memory)
  returns the findings; the rules live in `services::crashdiagnosis`, one file
  per rule, registered in one table.

### Release signing

- The release workflow can Authenticode-sign the Windows installer through Azure
  Artifact Signing: the app executable, Tauri's NSIS plugins, the installer theme
  plugin, the uninstaller and the installer carry a timestamped signature, and
  the updater signature is created afterwards over the signed installer.
- The release workflow can Developer-ID sign and notarize the universal macOS
  app when the Apple signing secrets are configured.
- Without the secrets and variables listed in CONTRIBUTING.md, the workflow
  behaves as before: unsigned Windows installer, ad hoc signed macOS app. Forks
  need no setup.

### Mod profiles

- Save named profiles per instance in the Content tab (up to 20, names of 1 to
  40 characters) and switch between them, for example a lean "Performance" set
  and a "Full" set. A profile remembers which mods and shaders are on; resource
  packs are chosen in the game and are not part of it.
- Applying a profile switches content exactly like the on/off switches do: the
  files and `instances.json` change together or not at all, it is refused while
  the game runs, and pinning is untouched. Mods installed after a profile was
  saved stay as they are, and mods removed since are ignored.
- The toolbar shows the active profile and marks it "modified" once the current
  state differs, with "Reset to ..." in the menu to restore it. Saving under an
  existing name asks before overwriting; profiles can be renamed and deleted.
- Profiles are not exported with `.mrpack` files or templates. Duplicating an
  instance keeps its profiles; changing the Minecraft version or loader drops
  them, because they describe the old game's mods.

### Parallel instance operations

- Installing, importing or editing one instance no longer blocks the others:
  while a modpack downloads or an instance installs, you can launch another
  instance, change its settings, back up its worlds or delete it. Before, a
  single launcher-wide lock refused everything with "An installation or change
  is already in progress".
- Two operations on the same instance still exclude each other, and a running
  game still refuses changes to its own instance.
- Moving the instance folder, clearing the mod cache and the startup clean-up
  of interrupted operations need the whole library to themselves: they are
  refused while any instance operation runs and hold off new ones until they
  finish.
- Game installs still take turns writing the shared libraries, assets and Java
  runtimes; a second install waits for the first instead of failing.
- Content jobs started from the interface (adding content, importing,
  exporting, world backups) still run one after another. The instance pages
  block launching and editing only for the instance a job works on.

### Shortcuts and deep links

- Create a desktop shortcut from an instance's menu (Home, library, instance
  page): a `.url` file on Windows, a `.desktop` file on Linux (also added to
  the application menu) and a `.webloc` file on macOS. A double click starts the
  instance without a prompt. The shortcut holds only a `pumpkin://launch/<id>`
  link with a token, derived from a per-installation secret in
  `shortcut-secret.txt` and valid for that instance only; an existing file is
  never overwritten.
- The shortcut carries the instance's own icon: the image you picked, otherwise
  the modpack's icon (Modrinth, CurseForge, FTB and Technic packs; the launcher
  downloads it once when you create the shortcut), otherwise the pixel icon. It
  is stored as a 256 px `.ico` (Windows) or `.png` (Linux, macOS) in
  `shortcut-icons/` in the launcher's data folder and replaced when you create
  another shortcut. On Windows, a data path with non-ASCII characters falls back
  to the launcher icon, since `.url` files are read in the ANSI code page. On
  macOS the icon is applied through the Finder; this path has not been tried on a Mac.
- Importing from the CurseForge App now brings the instance's icon along: the
  image set in the app (`profileImagePath`), otherwise the icon of the installed
  modpack, which the app stores only as an address and the launcher downloads once
  from CurseForge's image server (`forgecdn.net`, nothing else). If it cannot be
  loaded within 15 seconds, the instance keeps its pixel icon.
- Register the `pumpkin://` scheme with the installer and bundles. A link opens
  a running launcher or starts it: `pumpkin://launch/<id>` (optionally
  `?world=<folder>` or `?server=<host[:port]>`) always asks "Start <name>?"
  unless it carries a valid shortcut token, `pumpkin://open/<id>` opens the
  instance page and `pumpkin://install/modrinth/<type>/<slug>` opens the
  project, where installing is still your decision. Malformed links, unknown
  paths and links for instances that no longer exist are ignored or reported
  without starting anything.
- Settings > Java & launch gets "Open Modrinth and CurseForge links in Pumpkin"
  (Windows and Linux, off by default): it registers `modrinth://` and
  `curseforge://` for this launcher and switching it off releases them again.
  The switch shows what the system reports, and the launcher never registers
  these schemes on its own.
- Linux AppImages register `pumpkin://` for the current user at startup, as the
  package itself cannot.

### CurseForge downloads

- Modpacks and mods whose authors hide the download address from other launchers
  no longer send you to the CurseForge website. When the API names no address, the
  launcher loads the file from CurseForge's CDN path for that file id and name, the
  same address the website uses, and still verifies size and SHA-1. A pack plan checks
  that the CDN serves the file; only a file the CDN refuses is still listed for a
  manual download.
- The catalog (Discover) now shows these files as installable too, and single mods
  and their dependencies use the same path.

### Launch environment, hooks and argument files

- Each instance (Settings tab, "Launch environment") and the launcher (Settings >
  Java & launch) can set environment variables, a wrapper command and commands
  that run before launch and after exit. An instance's value wins per field; an
  empty field uses the launcher default.
- Environment variables follow `[A-Za-z_][A-Za-z0-9_]*` (up to 64, values up to
  4096 characters); names starting with `PUMPKIN_` are reserved for the launcher
  and refused. The Pumpkin Bridge variables are applied last and always win.
- The wrapper (`wrapper args... java ...`) and the hooks are started directly,
  never through a shell; quotes group words, backslashes stay as typed. A wrapper
  that cannot be found stops the launch with a clear error. On Linux, presets
  add GameMode, MangoHud, NVIDIA PRIME offload and AMD `DRI_PRIME`.
- The pre-launch command runs in the game folder after the launch is prepared;
  a failure or running longer than 60 seconds cancels the launch with its exit
  code in the message. The post-exit command runs in the background after the game
  exits (also limited to 60 seconds) and only logs failures. Both receive
  `PUMPKIN_INSTANCE_ID`, `PUMPKIN_INSTANCE_NAME`, `PUMPKIN_GAME_DIR`,
  `PUMPKIN_MC_VERSION` and `PUMPKIN_LOADER`; the post-exit command also gets
  `PUMPKIN_EXIT_CODE` (`-1` when the game left no code).
- Modpack, template and launcher imports never carry wrappers, hooks or variables;
  only duplicating your own instance copies them.
- With Java 9 or newer, Minecraft now starts with a single `@file` argument: the
  arguments, including the Microsoft access token, no longer appear on the command
  line and the Windows command-line length limit no longer applies. The file is
  owner-only on Linux and macOS, lives in the launcher's cache folder and is deleted
  seconds after the start; leftovers of a crashed session are removed at startup.
  Java 8 (older Minecraft versions), an unknown Java version and, on Windows,
  arguments or folders with non-ASCII characters keep the plain command line.
- Stopping a game ends the whole process tree, so a wrapper that starts Minecraft
  as a child (any script on Windows) no longer leaves the game running and the
  instance marked as running. A wrapper's console window is hidden on Windows.


## 0.4.0 — 2026-10-08

### Windows installer

- Brand NSIS welcome/finish panels and installer/uninstaller headers with the
  seasonal Buddy, pixel wordmark and dark Pumpkin palette.
- Add a custom template based on Tauri CLI 2.12.1, with concise German/English
  copy and direct navigation to Finish after a successful installation.
- Use a cohesive native dark theme for the title bar, navigation, inputs,
  checkboxes and progress, with larger text and copper actions.
  Preserve keyboard behavior and font-aware uninstall option placement.
- Retain per-user installation, existing-install maintenance, WebView2 setup,
  updater flags, file associations and opt-in app-data removal.
- Add an instance-folder page. The installer writes a request that the launcher
  applies at its next start. Suggest Documents/Pumpkin Launcher/Instances instead
  of the old AppData default, while preserving existing custom locations.
  The page rejects relative and drive-relative paths, drive roots, the program
  folder, system folders, `%APPDATA%`, `%LOCALAPPDATA%`, the metadata folder,
  `C:\Users`, the profile, Documents, Desktop and Downloads; the launcher
  validates again.
- Use Big Shoulders Display (headings, larger) and Hanken Grotesk (body) in the
  installer, embedded in the theme DLL, and remove the left stripe.
- Set installer headings in larger uppercase type and draw original artwork
  proportionally inside the image controls, without squeezing the wordmark.
- Publish the installer as Jonas Laux. The optional uninstall checkbox now removes
  only `accounts.json`, `skins.json` and `templates.json`; the uninstaller never
  deletes directories.

### Storage

- Choose where instances are stored in Settings > Storage, and open the folder
  or an instance's folder from there. The launcher copies the instance folders
  listed in `instances.json`, verifies them, switches, then removes the old root
  without deleting unknown entries (reported as retained). Nothing is
  overwritten, relocation is refused while a game runs, and a failure keeps the
  old folder.
- An installer request that cannot be applied never blocks startup: it is set
  aside as `instances-path-request.txt.rejected`, the launcher uses the current
  or default library and shows a notice. Only a missing or unsafe stored
  location stops startup.
- New Windows installs default to `Documents\Pumpkin Launcher\Instances`;
  existing libraries stay where they are.
- Use friendly Windows data folders named Pumpkin Launcher in `%APPDATA%` and
  `%LOCALAPPDATA%` instead of `dev.laux.launcher`. The internal identifier and
  keyring entry are unchanged.

### Settings

- Move the privacy service list and source attribution into an on-demand dialog
  under About & support.
- Move detailed Friends, Java and storage explanations into local information
  dialogs. Keep controls, concise permission summaries, warnings and consent
  confirmations directly accessible.
- Support keyboard scrolling, focus return and narrow-window reflow in the
  information dialogs, with German and English labels.

### Desktop maintenance

- Consolidate content-row state, lazy changelog disclosures, context-menu events,
  dialog removal and query-cache updates without changing desktop interactions.
- Reuse shared checksum, loader-name and lock helpers; keep world import and
  restore directory creation and rollback in one extraction path.
- Centralize Bridge Friends-availability checks and relay fixtures; remove the
  unused protocol-1 request signal and retain current protocol-2 operations.
- Reduce repeated allocations in grouping, JVM-property parsing and smoke
  reports. Keep Java request completion on the same main-thread executor.
- Add regression coverage for world rollback, JVM-property precedence and
  tooling boundaries. Make proxy checks return a failing exit status on failure.

### Known limits

- A requested instance folder that holds a large library is moved at startup,
  before the window opens, and shows no progress. Moving it from Settings >
  Storage reports success or failure when it finishes.
- Before moving, the launcher refuses while a game started by this session runs.
  Games started by an earlier launcher session are only detected on Windows,
  through the world lock; on Linux and macOS close the game first.
- The first start after updating from 0.3.3 renames `%APPDATA%\dev.laux.launcher`
  to `%APPDATA%\Pumpkin Launcher` and moves the WebView profile; an existing
  library keeps its contents. The program files stay in
  `%LOCALAPPDATA%\Pumpkin Launcher`. Windows installers are still not
  Authenticode-signed.

## 0.3.3 — 2026-10-07

### Announcements

- Add a full-width announcements reader in the sidebar, backed by the public
  GitHub Discussions category feed, with complete formatted posts and pagination.
- Show an unread badge throughout the launcher. Check for announcements at
  startup and every five minutes while the window is active, without a GitHub login.
- Keep read status locally across restarts. Opening a specific post marks it read;
  users can mark it unread again or mark all loaded posts read.
- Keep the header compact and use restrained seasonal accents, without explanatory
  banners. Preserve cached posts when refreshing fails.

### Shared page layout

- Apply compact headers, full-width content areas and restrained seasonal
  accents across library, instance details, Discover, Skins, Friends, Settings
  and the not-found page.
- Place settings navigation, Friends requests and the current skin beside their
  main content on wide windows; stack the workspace on smaller windows.
- Move primary actions into page headers and remove redundant introductory
  banners without removing account, consent, privacy or error guidance.
- Remove the sidebar's inner active marker; use the active surface and accent
  icon color while retaining the keyboard focus ring.
- Remove the decorative Pumpkin beside Home's Play button and its hover/focus
  animation state. Keep Play and the instance menu unchanged.
- Promote the shared workspace into exported Pixel Kit components and migrate
  all page consumers away from raw layout classes.
- Use the Kit's icon-bearing pixel-plate tabs for Settings, with responsive
  keyboard navigation, visible panel focus and no inner selection bar.
- Add interactive workspace and disabled-tab examples to `/_kit`; keep selected
  horizontal tabs visible when navigating or resizing.

### Instance cards

- Restore large 256×144 wallpaper cards in Home's instance rail, with landscape
  scenes and square modpack icons integrated into the lower caption.
- Remove Home's visible page header; move New instance and Library beside the
  instance-rail heading, retaining an accessible page heading.
- Remove the library grid and its view switcher; retain full-width grouped
  lists with square icons, search, filters, persisted sorting and bulk selection.
- Stack library names above metadata and actions in narrow content areas,
  keeping Play, menus and selection reachable when zoomed.
- Preserve instance context menus and Home rail keyboard navigation;
  keep the wide Home cards in low windows rather than shrinking them to squares.

### Button alignment

- Use the same compact 40×40 instance-menu button on Home and instance details.
- Fix asymmetric padding in small and large ghost icon buttons, centering
  list-end menus, skin rotation controls and other square icon buttons.
- Preserve icon pixel snapping, hover/press feedback and accessible labels.



## 0.3.2 — 2026-10-07

### Launcher interface

- Keep an available launcher update visible beside Live Sharing in the title bar;
  the button opens the existing update settings without installing automatically.
- Make the title-bar logo and wordmark non-interactive while keeping them draggable.
- Replace browser right-click menus with page-specific app actions, preserving
  instance and skin menus and providing text-editing actions in fields.
- Prevent Sonner's swipe and dismissal hit-area transforms from stretching the
  visible toast plate, and hide backing-toast contents in collapsed stacks.

### Marketing website

- Rewrite the marketing copy in natural English and translate download guidance
  and legal pages.
- Keep normal section navigation out of the address bar's URL fragment while
  preserving keyboard focus and native anchor fallback without JavaScript.
- Remove the app screenshot tour, marketing trailer, download-verification
  disclosure and seasonal pumpkin collection in the footer.
- Add a staged page-load entrance, scroll-driven world-card reveals, desktop
  parallax and pointer tilt, and a choreographed outro using GSAP/ScrollTrigger.
  Respect reduced motion and let immediate interaction finish the load entrance.
- Prepare scroll-reveal start states offscreen and preserve completed entrances
  across responsive and motion-preference changes to prevent text flicker.
- Give main sections a viewport-height minimum while allowing content to grow;
  animate FAQ disclosure opening and closing without moving its heading.
- Overlay the header on the hero and reveal its background after scrolling.
- Keep beta wording version-free and display “LET'S PLAY.” on one line.
- Exclude unused font subsets/weights and keep landscape artwork lazy-loaded.
- Keep navigation visible while scrolling, tighten logo spacing and add an
  icon-only back-to-top control using the launcher's up icon and existing buttons.
- Serve English legal pages at `/privacy/` and `/legal-notice/` without `.html`
  links, including on subdirectory-based static hosting.
- Fit headings and long privacy-policy domains on narrow screens.
- Replace download-card accordions with info-icon installation dialogs, including
  OS requirements, trust-qualified security guidance and first-launch steps.
- Give Windows, macOS and Linux distinct pixel-art banners: the Windows 11
  symbol, Apple logo and a Linux-only penguin.
- Apply launcher-style pixel scrollbars to page and dialog scroll areas, with
  standard color fallbacks and forced-color support.
- Make both download-section dividers span the full page width.
- Remove fixed hero minimum heights and scale its typography and spacing with
  the viewport so Buddy remains visible during the entrance on 16:9 displays.
- Keep world-card frames above animated artwork during scroll and pointer tilt.
- Center header navigation and footer copy independently of their neighboring
  elements, with stacked layouts on narrow screens.
- Remove button-icon hover movement and the hero's secondary feature link.

## 0.3.1 — 2026-10-07

### Dependencies and build tooling

- Refreshed launcher and P2P-tool Rust dependencies and lockfiles, including Tauri,
  Tokio, UUID and Base64.
- Migrated credential storage to Keyring Core and the current native Windows,
  Apple and Secret Service stores without changing credential identities or
  legacy token encoding. Linux reconnects per operation so a failed service
  initialization can recover. Added isolated native persistence and recovery
  checks to CI.
- Updated the frontend to React 19.3, React Router 8.4 and TypeScript 7, with pnpm
  12.9.1 and refreshed JavaScript dependencies. Kept Vite 8.3.2 while 8.3.3 is
  inside pnpm's release-age quarantine; the supply-chain policy remains enabled.
- Updated SHA-pinned GitHub Actions, including all five pending Dependabot
  updates, Checkout and Pages deployment.
- Updated Gradle to 9.8.0, Forge Renamer's plugin/tool to 1.1.1/2.2.3 and the
  Mixin annotation processor to 0.8.7. Resolve Renamer's published implementation
  directly because its plugin marker is missing, replace its unpublished tool
  default and run it on the prepared node JDK. Retain the oldest game-supplied
  Gson and Log4j API contracts for the supported Minecraft matrix.
- Updated the launch-video HyperFrames CLI pin to 0.8.138.

## 0.3.0 — 2026-10-06

### Pumpkin Bridge

- The in-game Pumpkin button now opens a module home, with Friends as its first
  module, rather than opening the Friends-only menu directly.
- The shared Pumpkin Bridge connection and menu can work while Friends is off;
  private Friends data and actions still require opt-in.
- Redesigned the in-game Friends interface with player heads and Pumpkin UI.
- Updated Friends to use Minecraft names; name requests still need a configured
  directory and a recipient who allows them.
- Made the shared production core compatible with Java 8.
- Expanded the build registry to 102 exact Fabric, Quilt, Forge and NeoForge
  targets across 27 selected Minecraft releases, including 1.16.5. The validated
  package is embedded in the launcher; automatic injection requires recorded
  startup evidence. Registration and startup do not prove every runtime flow.

### Minecraft and world sharing

- Lowered the Friends hosting and joining floor to Minecraft 1.16.5; guests still
  need the host's exact game release, loader and required mods.
- Added Forge installation and launch support from Minecraft 1.16.5, including
  legacy runtime libraries, and patched legacy game logging to Log4j 2.17.1.

### Fixes

- Made an already requested cancellation win over a ready operation before it
  commits an instance, preventing cancelled duplication from leaving a copy.
- Aligned release tests with the Java 17 minimum for JUnit on Java 8 game targets.
- Fixed the bare-Node Mojang key check and mod-packaging jobs so they do not
  require an uninstalled pnpm cache integration.
- Preserved the development launch classpath for Java 8 Fabric targets.
- Added a real software Vulkan driver for headless Minecraft 26.3 CI rendering.
- Kept Minecraft profile requests explicitly HTTPS and removed sensitive values
  from failed-test diagnostics.

### Current limits

Friends remains experimental. Authenticated sharing and joining with two accounts
across different networks and equivalent non-Windows runtime behavior are not yet
established. Bridge startup evidence does not prove those flows or rendered menus.
The per-instance Bridge controls remain hidden while Friends is off; the global
Bridge switch is independent of Friends consent. The historical CJK-path warning
below does not establish that 0.3.0 fixes that problem.

### Documentation

- Added clearer download, installation, first-game and Friends instructions.
- Separated the general Bridge documentation from Friends and consolidated
  developer setup and release packaging in `CONTRIBUTING.md`.
- Corrected the privacy reference to disclose sender display names stored with
  directory requests.

## 0.2.0 — 2026-10-05

### Friends

- Introduced opt-in friend requests, presence, invitations and world sharing in
  the launcher, including friend requests by Minecraft name.
- Added the in-game Pumpkin Friends hub: friends, requests, invitations,
  sharing controls and notifications.
- Bundled and automatically added the in-game integration to supported Fabric,
  NeoForge and Forge launches without changing the instance's `mods` folder or exports.
- Kept consent, process validation and encrypted direct/relay connections under
  launcher control. Added startup-failure detection that disables the in-game
  integration for the next launch when it prevents the game from starting.
- Added stable installer filenames for website downloads.

### Known limits

The original release's known limits included Windows-only runtime evidence,
unsupported game/loader combinations and startup problems with Chinese, Japanese
or Korean characters (CJK) in the launcher's data-folder path. These describe **0.2.0**,
not the current supported Minecraft versions and loaders for Bridge.

**0.2.0 workaround:** if a CJK folder path prevents Minecraft from starting with
the in-game Friends menu, open the affected instance's **Worlds** tab, open
**Friends menu in the game**, switch off **Friends menu in the game for this instance**,
then retry the launch. That instance control is shown while Friends is enabled.
Alternatively, switch off the menu globally at **Settings > Friends > Friends menu in the game**.
Report the error through [Help and privacy](README.md#help-and-privacy).
See the original [0.2.0 Known limits](https://github.com/jonax1337/pumpkin-launcher/releases/tag/v0.2.0#known-limits).
This is not a claim that 0.3.0 fixes the path problem.

## 0.1.0 — 2026-10-03

First public beta for Windows, Linux and macOS.

- Microsoft sign-in and separate Vanilla, Fabric, Forge, NeoForge and Quilt instances.
- Mods and modpacks from Modrinth, CurseForge, FTB and Technic, with content updates
  and modpack version switching that preserve worlds and local changes.
- Instance duplication, `.mrpack` export, `.mrpack`/CurseForge ZIP import and import
  from Prism/MultiMC, Modrinth App, CurseForge App and ATLauncher.
- Worlds, backups, restore, servers, Quick Play (launch directly into a world or server)
  and per-world datapacks (files that change a world's gameplay without a mod loader).
- Skins and capes with 3D previews; skin import from files or player names.
- Screenshot browser, session logs, crash hints and redacted log sharing through mclo.gs.
- Signed automatic updates, installed with consent and deferred while games or tasks run.
- German and English, keyboard shortcuts, adjustable text size and reduced motion.

The first beta was exercised primarily on Windows; Linux and macOS packages
were not yet verified on real machines. Installers were not OS code-signed.

Historical entries summarize the annotated [0.1.0](https://github.com/jonax1337/pumpkin-launcher/releases/tag/v0.1.0)
and [0.2.0](https://github.com/jonax1337/pumpkin-launcher/releases/tag/v0.2.0)
release notes.
