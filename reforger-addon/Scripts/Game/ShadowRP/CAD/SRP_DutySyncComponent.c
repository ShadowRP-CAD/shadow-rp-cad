[BaseContainerProps()]
class SRP_DutySyncComponentClass : ScriptComponentClass
{
}

// Add to the replicated player-character prefab. Locker/radial scripts call SetDutyStatus().
class SRP_DutySyncComponent : ScriptComponent
{
	void SetDutyStatus(string status, string callsign, string agency, string rank = "Officer")
	{
		Rpc(RpcAsk_SetDutyStatus, status, callsign, agency, rank);
	}

	[RplRpc(RplChannel.Reliable, RplRcver.Server)]
	protected void RpcAsk_SetDutyStatus(string status, string callsign, string agency, string rank)
	{
		IEntity player = GetOwner();
		PlayerManager playerManager = GetGame().GetPlayerManager();
		int playerId = playerManager.GetPlayerIdFromControlledEntity(player);
		vector position = player.GetOrigin();

		SRP_CADUnitStatusRequest payload = new SRP_CADUnitStatusRequest();
		payload.reforgerUid = SCR_PlayerIdentityUtils.GetPlayerIdentityId(player);
		payload.playerName = playerManager.GetPlayerName(playerId);
		payload.callsign = callsign;
		payload.agency = agency;
		payload.rank = rank;
		payload.dutyStatus = status;
		payload.locationGrid = SCR_MapEntity.GetGridLabel(position);
		payload.worldX = position[0];
		payload.worldZ = position[2];

		SRP_CADNetworkManager network = SRP_CADNetworkManager.GetInstance();
		if (network)
			network.SyncUnitStatus(payload);
	}
}
