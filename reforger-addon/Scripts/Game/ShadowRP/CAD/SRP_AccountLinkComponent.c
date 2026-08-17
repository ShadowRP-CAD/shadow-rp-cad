[BaseContainerProps()]
class SRP_AccountLinkComponentClass : ScriptComponentClass
{
}

// Add this component to the replicated player-character prefab.
class SRP_AccountLinkComponent : ScriptComponent
{
	void RequestAccountLink()
	{
		Rpc(RpcAsk_GenerateLink);
	}

	[RplRpc(RplChannel.Reliable, RplRcver.Server)]
	protected void RpcAsk_GenerateLink()
	{
		IEntity player = GetOwner();
		PlayerManager playerManager = GetGame().GetPlayerManager();
		int playerId = playerManager.GetPlayerIdFromControlledEntity(player);
		string playerName = playerManager.GetPlayerName(playerId);
		string reforgerUid = SCR_PlayerIdentityUtils.GetPlayerIdentityId(player);

		SRP_CADNetworkManager network = SRP_CADNetworkManager.GetInstance();
		if (!network || reforgerUid.IsEmpty())
		{
			DeliverLinkResult(false, "Unable to read your Reforger identity.");
			return;
		}

		network.GenerateLinkToken(this, reforgerUid, playerName);
	}

	// Called on the server by the retained REST callback.
	void DeliverLinkResult(bool success, string value)
	{
		Rpc(RpcDo_ShowLinkResult, success, value);
	}

	[RplRpc(RplChannel.Reliable, RplRcver.Owner)]
	protected void RpcDo_ShowLinkResult(bool success, string value)
	{
		if (success)
			SCR_HintManagerComponent.ShowCustomHint("Your linking code is: " + value + ". Enter this on the CAD site within 10 minutes.", "Shadow RP Account Linking", 15);
		else
			SCR_HintManagerComponent.ShowCustomHint(value, "Shadow RP Account Linking", 10);
	}

	// Shared client entry point used by SRP_EmergencyCallAction.
	void RequestEmergencyCall(string description)
	{
		Rpc(RpcAsk_SendEmergencyCall, description);
	}

	[RplRpc(RplChannel.Reliable, RplRcver.Server)]
	protected void RpcAsk_SendEmergencyCall(string description)
	{
		IEntity player = GetOwner();
		PlayerManager playerManager = GetGame().GetPlayerManager();
		int playerId = playerManager.GetPlayerIdFromControlledEntity(player);
		vector position = player.GetOrigin();

		SRP_CADEmergencyRequest payload = new SRP_CADEmergencyRequest();
		payload.callTitle = "In-game emergency call";
		payload.callerName = playerManager.GetPlayerName(playerId);
		payload.locationGrid = SCR_MapEntity.GetGridLabel(position);
		payload.description = description;
		payload.worldX = position[0];
		payload.worldZ = position[2];

		SRP_CADNetworkManager network = SRP_CADNetworkManager.GetInstance();
		if (network)
			network.SendEmergencyCall(payload);
	}
}
