# Pumpkin Friends

Last updated: 2026-10-06.

Friends is optional and off by default. With a Microsoft account, you can exchange one-time friend codes, see who is online and invite friends in other networks into a singleplayer world. Exact Minecraft-name requests are available when a directory is configured; the recipient must opt into being findable.

## Using Friends

### Turn it on

Both players need Pumpkin Launcher, a signed-in Microsoft account that owns Minecraft: Java Edition, and a working system keyring. Keep both launchers open during play.

In **0.3.0**, hosting and joining require Minecraft **1.16.5 or newer**. The in-game menu has its own exact version/loader requirements.

The **keyring** is your computer's secure password storage. Windows Credential Manager and macOS Keychain are built in; Linux needs a working Secret Service store, such as GNOME Keyring or KWallet. If Pumpkin reports a credential-storage error, make sure that store is available and unlocked. For persistent errors, open **Settings > Support** and include the error plus **Copy debug info**, not passwords or tokens.

Open **Settings > Friends**, turn on **Friends**, and read the privacy notice. If the build uses third-party relays, it asks for separate consent. This is optional; normal singleplayer play does not need Friends.

### Add a friend with a code

1. Open the launcher's **Friends** page and choose **Add friend > My code > Create code**.
2. Give the code privately to your friend. Do not post it publicly.
3. Your friend opens **Add friend > Enter code**, pastes it, and chooses **Send request**.
4. You open **Requests** on the Friends page and choose **Accept**. Both players must agree before they become friends.

Codes are single-use and expire after seven days. Pending requests can be delivered for up to fourteen days; keep the launchers online for delivery. Local aliases change only your own labels.

As an alternative, use **Add friend > By name** with the exact Minecraft name. The recipient must enable **Settings > Friends > Findable by Minecraft name**, and the build needs a configured directory. If the directory cannot be reached, use a code instead.

### Share a world and join

1. **Host:** start your instance, open a singleplayer world, press **Esc** for Minecraft's pause menu, and choose **Open to LAN**. An instance is a separate game setup with its own worlds and mods.
2. In Pumpkin, open that instance's **Worlds** tab and choose **Share with friends**. Select the confirmed friends who are online, then choose **Share**. If LAN detection needs help, **Enter port manually** accepts the port Minecraft displays.
3. **Guest:** open the invitation with **View**, choose a matching **Instance** if prompted, and press **Join**.

The guest needs the same Minecraft release, loader and required mods as the host. A loader, such as Fabric or Forge, lets mods run. If the invitation reports a mismatch:

- **Plain Minecraft:** if you have no matching setup, choose **Create vanilla instance** to create one before joining.
- **Modded world:** obtain the host's matching modpack and pack version, or agree on the missing/extra mods listed in the invitation and adjust your instance. To import a pack, open **Library > New instance > File**; use **Another launcher** if the matching setup is in another launcher. Then choose **Check again**.

Friends does not copy the host's world, mods or configuration files, or automatically transfer or install a matching modpack.

The host can choose **Stop sharing** in the Worlds tab to disconnect guests and expire invitations. A guest can choose **Leave** in the active connection panel. Closing the launcher ends sharing/joining. Before Minecraft 26.2, stopping sharing does not close the world's LAN port: leave the world as well to stop local-network access.

### In-game menu

In **0.3.0**, Friends is a feature in the **Pumpkin Bridge** menu for supported modded Microsoft-account launches. The build registry covers selected Fabric, Quilt, Forge and NeoForge targets; the launcher embeds the validated package, but automatic injection requires recorded startup evidence. Supported launches receive the bundled client mod automatically; no manual JAR installation is needed. See [Check your installed build](../bridge/README.md#check-your-installed-build) and [startup recovery](../bridge/README.md#startup-recovery) for the controls and their limits. Private Friends data and actions remain unavailable until opt-in; identity and privacy settings remain in the launcher.

**Historical 0.2.0 compatibility:** that release's pause-menu **Pumpkin Friends** button supported selected Fabric releases from Minecraft 1.20 through 26.3, selected NeoForge releases, and Forge 1.20.1. The [0.2.0 supported-games table](https://github.com/jonax1337/pumpkin-launcher/releases/tag/v0.2.0#supported-games) gives its exact Minecraft and minimum loader versions. Vanilla, Quilt and older or unlisted combinations did not get that release's in-game menu. Launcher sharing and joining in **0.2.0** required Minecraft **1.20 or newer**, even without the menu.

For historical **0.2.0** startup failures with Chinese, Japanese or Korean characters in the launcher's data-folder path, follow the [release-specific menu workaround](../../CHANGELOG.md#known-limits). The original [0.2.0 Known limits](https://github.com/jonax1337/pumpkin-launcher/releases/tag/v0.2.0#known-limits) describe that release; they do not establish a fix in 0.3.0.

## Connection and privacy

A **relay** is a server that forwards encrypted traffic between your launchers when they cannot connect directly. It cannot read the world tunnel's content. On a direct path, peers can see each other's public IP and local interface addresses. **Settings > Friends > Always connect through a relay** hides those addresses from peers, with additional latency; the relay operator still sees connection metadata, such as IP addresses, connected endpoints and timing. Changing this setting ends an active share/join.

Opening a world to LAN also exposes Minecraft's LAN port to the local network, as in Vanilla. Other mods in the same game process can access the local Bridge channel. Only run mods you trust. Start with [your privacy choices](PRIVACY.md#your-choices-at-a-glance); the same reference explains data retention.

## Availability and limits

Official tagged release builds enable the `beta-relays` feature (n0 relays, with separate consent) and configure the Friends directory. Release users do not need to run their own relay or directory. An ordinary source build without that feature or directory configuration has an empty production relay map and no default directory address; it needs operator configuration for Friends connectivity and name requests.

Friends remains experimental. A working in-game menu is not evidence that authenticated sharing and joining with two accounts across different networks is reliable. That cross-network behavior and equivalent non-Windows runtime evidence are not yet established. Check **Settings > Friends > Network** for the connection status; if it reports an unreachable relay, check your internet connection. For persistent errors, use the launcher's **Settings > Support** and include the message plus **Copy debug info**.

There is no chat, voice, public discovery list or telemetry. If the in-game button is missing, first use the release-specific compatibility guidance [above](#in-game-menu); Friends setup does not make an unsupported game/loader combination supported.

## Technical documentation

| Document | Purpose |
| --- | --- |
| [SPEC.md](SPEC.md) | Friends transport, identity, sessions and directory API contracts |
| [Pumpkin Bridge](../bridge/README.md) | General Launcher–Minecraft integration, injection, local protocol and consent boundaries |
| [PRIVACY.md](PRIVACY.md) | Data recipients, retention and security limitations |
| [RELAY-OPS.md](RELAY-OPS.md) | Relay deployment, configuration and incident handling |
| [mod README](../../mod/README.md) | Build setup and current support registry |
| [directory README](../../directory/README.md) | Worker deployment and pinned-key maintenance |
| [relay configuration](../../infra/relay/) | Deployable server files |
