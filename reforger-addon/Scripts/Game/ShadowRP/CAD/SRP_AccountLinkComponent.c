[BaseContainerProps()]
class SRP_AccountLinkComponentClass : ScriptComponentClass
{
}

// Add this component to the replicated player-character prefab.
class SRP_AccountLinkComponent : ScriptComponent
{
	override void OnPostInit(IEntity owner)
	{
		super.OnPostInit(owner);
		RplComponent replication = RplComponent.Cast(owner.FindComponent(RplComponent));
		if (replication && replication.IsOwner())
			GetGame().GetCallqueue().CallLater(RequestFirstJoinLink, 4000, false);
	}

	protected void RequestFirstJoinLink()
	{
		Rpc(RpcAsk_FirstJoinLink);
	}

	[RplRpc(RplChannel.Reliable, RplRcver.Server)]
	protected void RpcAsk_FirstJoinLink()
	{
		IEntity player = GetOwner();
		PlayerManager playerManager = GetGame().GetPlayerManager();
		int playerId = playerManager.GetPlayerIdFromControlledEntity(player);
		string playerName = playerManager.GetPlayerName(playerId);
		string reforgerUid = SCR_PlayerIdentityUtils.GetPlayerIdentityId(player);
		SRP_CADNetworkManager network = SRP_CADNetworkManager.GetInstance();
		if (network && !reforgerUid.IsEmpty())
			network.CheckFirstJoinOnboarding(this, reforgerUid, playerName);
	}

	// Called on the server by the retained REST callback.
	void DeliverLinkResult(bool success, string value)
	{
		Rpc(RpcDo_ShowLinkResult, success, value);
	}

	void DeliverOnboardingCode(string token)
	{
		Rpc(RpcDo_ShowFirstJoinCode, token);
	}

	[RplRpc(RplChannel.Reliable, RplRcver.Owner)]
	protected void RpcDo_ShowFirstJoinCode(string token)
	{
		SCR_HintManagerComponent.ShowCustomHint("Welcome to Shadow RP! Your one-time account code is " + token + ". Sign in to the CAD website and enter it within 10 minutes to secure your persistent bank, money, and investments.", "LINK YOUR SHADOW RP ACCOUNT", 30);
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
	void RequestEmergencyCall(string description, string serviceType = "911")
	{
		Rpc(RpcAsk_SendEmergencyCall, description, serviceType);
	}

	[RplRpc(RplChannel.Reliable, RplRcver.Server)]
	protected void RpcAsk_SendEmergencyCall(string description, string serviceType)
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
		payload.serviceType = serviceType;
		payload.worldX = position[0];
		payload.worldZ = position[2];

		SRP_CADNetworkManager network = SRP_CADNetworkManager.GetInstance();
		if (network)
			network.SendEmergencyCall(payload);
	}

	void DeliverEmergencyDispatch(string tenCode, string priority, string grid, string dispatchText)
	{
		Rpc(RpcDo_ShowEmergencyDispatch, tenCode, priority, grid, dispatchText);
	}

	[RplRpc(RplChannel.Reliable, RplRcver.Owner)]
	protected void RpcDo_ShowEmergencyDispatch(string tenCode, string priority, string grid, string dispatchText)
	{
		SCR_ChatPanelManager chat = SCR_ChatPanelManager.GetInstance();
		if (chat)
			chat.OnNewMessage("[AI DISPATCH] " + dispatchText);
		SCR_HintManagerComponent.ShowCustomHint(dispatchText, "AI DISPATCH RADIO · " + priority + " · " + tenCode, 18);
	}
}
