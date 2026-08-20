# Shadow RP v117 compatibility

This integration is aligned with the supplied **Shadow RP V2 v117** reference validated in Arma Reforger Workbench 1.8.0.10.

It preserves:

- Shadow RP Workshop GUID `37A6F000254E4253`.
- Housing dependency `6B39A5D47E2C810F` and the v1.1.7 door-action fix.
- RPPhone dependency `65EF7B586691A802`.
- Police/EMS dependency `A75A11CE5000E911` and its server-authoritative duty registry.
- EPF character persistence and the permanent-identity Bank2/ATM manager.
- The stock inherited player-controller prefab, world, loading screen, and Shadow RP logo.
- The explicit exclusion of addon `463404114BC14192` and its unconscious-character system.

The integration adds no player prefab components, GameMode replacement, world entity, or housing resource. It extends the already-installed CAD transport, RPPhone cell component, public-safety duty manager, and existing owner-replicated player-controller link in script only.

Emergency calls include the permanent Reforger identity for secure account resolution. The visible caller name comes from the active RPPhone roleplay name and is replaced by the linked CAD persona on the backend when available. Bank and stock-market persistence continue to use `Bnk_BankManagerComponent.GetBank(identityId)` and the existing 15-second ATM synchronization.

Before publishing:

1. Publish Shadow RP Everon Housing v1.1.7.
2. Run `Install-IntoShadowRPServer.ps1` against the complete v117 source folder.
3. Open that source in Workbench and run **Compile and Reload Scripts**.
4. Confirm zero script errors, then publish as an update to GUID `37A6F000254E4253`.
5. Fully stop and restart the dedicated server without deleting its profile or persistence database.

