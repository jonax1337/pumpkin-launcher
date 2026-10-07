# Changelog

Last updated: 2026-10-07.

For installation and a first game, start with the [launcher guide](README.md#download-and-install).

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

- Apply the compact header, full-width content area and restrained seasonal
  accents across Home, library, instance details, Discover, Skins, Friends,
  Settings and the not-found page.
- Place settings navigation, Friends requests and the current skin beside their
  main content on wide windows; stack the workspace on smaller windows.
- Arrange library poster groups side by side when space allows, while keeping
  the list view full-width.
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
