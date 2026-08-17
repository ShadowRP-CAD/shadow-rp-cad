# Shadow RP CAD Bridge — Workbench installation

This source addon is configured for the live Shadow RP backend and uses project GUID `A4C19E7B53D02461`.

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
6. Drag `Prefabs/ShadowRP/CAD/SRP_AccountLinkTerminal.et` into the arrival/spawn area. This recovery terminal issues replacement codes when a first-join code expires.
7. Save the world and test in **Dedicated Server** mode, not only local preview.

The player automatically receives a code four seconds after the first replicated character is created. The backend records that prompt permanently, so it is not displayed again on reconnect. The recovery terminal can issue another expiring code without resetting that one-time flag.

## Test checklist

1. Start the scenario and join with an unlinked account.
2. Confirm the top-screen `LINK YOUR SHADOW RP ACCOUNT` hint appears once.
3. Sign in at `https://shadowrp-cad.github.io/shadow-rp-cad/#/linking` and enter the code.
4. Confirm the website banner disappears and Civilian Hub banking unlocks.
5. Reconnect and confirm the automatic message does not repeat.
6. Use the wall-phone linking terminal and confirm a replacement code is generated.
7. Check dedicated-server logs for `[ShadowRP CAD] link.onboarding succeeded`.

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
