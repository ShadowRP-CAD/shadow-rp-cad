# Shadow RP CAD Bridge — Workbench installation

This source addon is configured for the live Shadow RP backend and uses project GUID `A4C19E7B53D02461`.

## Existing combined Shadow RP v117 server source

For the v117 server project that already contains the configured CAD/ATM bridge, install only the non-destructive AI extension. Publish **Shadow RP Everon Housing v1.1.7** first, as required by the supplied v117 release notes. Then, from this folder, run:

```powershell
.\Install-IntoShadowRPServer.ps1 -ServerSource "C:\Users\Dev\Desktop\Server Mods\ShadowRP-v115-NO-UNCON-SERVER-AND-HOUSING\Server-Source"
```

The installer verifies the Shadow RP project GUID plus the RPPhone, Police/EMS, Housing, persistent Bank2, and existing CAD prerequisites. It copies the integration as `SRP_ZZ_AIDispatchServerIntegration.c` so the base CAD classes compile first, backs up an older copy if present, and does not replace the configured API key, ATM sync, onboarding, housing, world, player-controller prefab, or branding assets. Open that server project in Workbench and compile before publishing.

The v117 bridge uses the persistent Bohemia identity for account and Bank2 synchronization, but sends the active RPPhone/CAD roleplay alias to dispatch. For linked callers, the backend resolves the CAD persona again and never displays the submitted platform name on the incident.

The remaining instructions below apply when publishing the CAD bridge as its own standalone Workshop addon.

## Install and validate

1. Copy this entire folder to `Documents\My Games\ArmaReforgerWorkbench\addons\Shadow RP CAD Bridge`.
2. Open **Arma Reforger Tools**, choose **Add Existing**, and select this addon's `addon.gproj`.
3. Open the project. In Script Editor choose **Build > Compile and Reload Scripts**. There must be no errors.
4. Open your server scenario in World Editor.

## Wire the scenario

1. Drag `Prefabs/ShadowRP/CAD/SRP_CADBridgeManager.et` into the world exactly once.
2. Select the manager and set **Internal Api Key** to the exact Railway `INTERNAL_API_KEY`. Keep the preconfigured API URL.
3. Open every playable player-character prefab used by Shadow RP.
4. Confirm it already has an `RplComponent`, then add `SRP_AccountLinkComponent` and `SRP_DutySyncComponent`.
5. Save each player prefab.
6. Save the world and test in **Dedicated Server** mode, not only local preview. No terminal or placed interaction is required.

The addon now declares RPPhone (`65EF7B586691A802`) as a dependency. `SRP_RPPhoneEmergencyBridge.c` connects the phone's `911`, `Police`, `Medical`, and `EMS` shortcut identifiers to the CAD automatically. If your RPPhone version renamed those widgets, update the matching string in that file to the identifier shown in the phone layout.

The player automatically receives a code four seconds after the first replicated character is created. It appears as a top-screen message for 30 seconds. The backend records that prompt permanently, so it is not displayed again on reconnect after that identity has received its code.

## Test checklist

1. Start the scenario and join with an unlinked account.
2. Confirm the top-screen `LINK YOUR SHADOW RP ACCOUNT` hint appears once.
3. Sign in at `https://shadowrp-cad.github.io/shadow-rp-cad/#/linking` and enter the code.
4. Confirm the website banner disappears and Civilian Hub banking unlocks.
5. Reconnect and confirm the automatic message does not repeat.
6. Check dedicated-server logs for `[ShadowRP CAD] link.onboarding succeeded`.
7. Put one LEO or EMS unit on duty, then press the matching RPPhone emergency shortcut from a civilian.
8. Confirm the CAD creates a 10-coded incident, automatically assigns a compatible 10-8 unit, and broadcasts `AI DISPATCH RADIO` to on-duty players.
9. On the web Dashboard click **Enable voice**, place another call, and confirm the spoken bulletin includes its grid and 10-code.

If a player lets the code expire before entering it, an administrator must clear that UID from `link_onboarding` before the next join. This preserves the strict one-message-only behavior.

## Publish and add to the server

In Workbench choose **Publish Project**, publish privately or unlisted for the first live test, and copy the Workshop mod ID. Add it to the dedicated server's `mods` array:

```json
{
  "modId": "A4C19E7B53D02461",
  "name": "Shadow RP CAD Bridge",
  "required": true
}
```

Use the exact Workshop mod ID shown by Workbench if it differs. Players automatically download required Workshop mods on join.

## Security

Never commit the real `INTERNAL_API_KEY`. Reforger addon packages are inspectable, so keep internal routes narrowly scoped and rotate the key if exposed. For stronger protection, restrict the backend by game-server IP at a proxy.

