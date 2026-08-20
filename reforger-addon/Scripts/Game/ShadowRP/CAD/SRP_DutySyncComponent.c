[BaseContainerProps()]
class SRP_DutySyncComponentClass : ScriptComponentClass
{
}

// Add to the replicated player-character prefab. Locker/radial scripts call SetDutyStatus().
class SRP_DutySyncComponent : ScriptComponent
{
	protected string m_DutyStatus = "10-7";
	protected string m_Agency = "";

	void SetDutyStatus(string status, string callsign, string agency, string rank = "Officer")
	{
		Rpc(RpcAsk_SetDutyStatus, status, callsign, agency, rank);
	}

	[RplRpc(RplChannel.Reliable, RplRcver.Server)]
	protected void RpcAsk_SetDutyStatus(string status, string callsign, string agency, string rank)
	{
		m_DutyStatus = status;
		m_Agency = agency;
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

	bool AcceptsDispatch(string agencyList)
	{
		return m_DutyStatus != "10-7" && !m_Agency.IsEmpty() && agencyList.Contains(m_Agency);
	}
}
