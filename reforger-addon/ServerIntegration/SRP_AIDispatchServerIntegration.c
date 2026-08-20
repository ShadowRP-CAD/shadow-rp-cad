// Drop-in integration for the combined Shadow RP server source.
// It extends the existing CAD/ATM bridge without replacing its configured files.

class SRP_AIDispatchResponse : JsonApiStruct
{
	int id;
	string call_title;
	string location_grid;
	string ten_code;
	string dispatch_text;
	string dispatch_agency;
	string priority;
	ref array<string> assigned_units = {};

	void SRP_AIDispatchResponse()
	{
		RegV("id"); RegV("call_title"); RegV("location_grid"); RegV("ten_code");
		RegV("dispatch_text"); RegV("dispatch_agency"); RegV("priority"); RegV("assigned_units");
	}
}

// Dedicated v117 request shape. This leaves the installed CAD bridge classes
// untouched while adding the permanent identity and RPPhone service type.
class SRP_AIEmergencyRequest : JsonApiStruct
{
	string apiKey;
	string callTitle;
	string callerName;
	string reforgerUid;
	string locationGrid;
	string description;
	string serviceType;
	float worldX;
	float worldZ;

	void SRP_AIEmergencyRequest()
	{
		RegV("apiKey"); RegV("callTitle"); RegV("callerName"); RegV("reforgerUid");
		RegV("locationGrid"); RegV("description"); RegV("serviceType");
		RegV("worldX"); RegV("worldZ");
	}
}

modded class JOB_jobComponent
{
	string SRP_CADGetRoleplayName()
	{
		return rpName;
	}
}

class SRP_CADIdentityBridge
{
	static string GetRoleplayAlias(IEntity player, int playerId)
	{
		if (player)
		{
			JOB_jobComponent job = JOB_jobComponent.Cast(player.FindComponent(JOB_jobComponent));
			if (job)
			{
				string roleplayName = job.SRP_CADGetRoleplayName();
				if (!roleplayName.IsEmpty())
					return roleplayName;
			}
		}
		return string.Format("RP Caller %1", playerId);
	}
}

modded class SRP_CADRestCallback
{
	override protected void Callback_OnSuccess(RestCallback callback)
	{
		if (m_Manager && m_RequestName == "call.911")
		{
			SRP_AIDispatchResponse dispatch = new SRP_AIDispatchResponse();
			dispatch.ExpandFromRAW(callback.GetData());
			if (!dispatch.dispatch_text.IsEmpty())
				m_Manager.SRP_AIBroadcastDispatch(dispatch);
		}
		super.Callback_OnSuccess(callback);
	}
}

modded class SRP_CADNetworkManager
{
	void SRP_AISendEmergencyCall(SRP_AIEmergencyRequest payload)
	{
		payload.apiKey = m_InternalApiKey;
		payload.Pack();
		Post("api/cad/call911", payload.AsString(), "call.911");
	}

	void SRP_AIBroadcastDispatch(SRP_AIDispatchResponse dispatch)
	{
		if (!Replication.IsServer() || !GetGame())
			return;
		ARS_PlayerRoleComponent roles = ARS_PlayerRoleComponent.GetInstance();
		PlayerManager players = GetGame().GetPlayerManager();
		array<int> playerIds = {};
		players.GetPlayers(playerIds);
		foreach (int playerId : playerIds)
		{
			bool policeMatch = dispatch.dispatch_agency.Contains("LEO") && roles && roles.IsOnPoliceDutyServer(playerId);
			bool medicalMatch = (dispatch.dispatch_agency.Contains("EMS") || dispatch.dispatch_agency.Contains("FIRE")) && roles && roles.IsOnEMSDutyServer(playerId);
			if (!policeMatch && !medicalMatch)
				continue;
			SCR_PlayerController controller = SCR_PlayerController.Cast(players.GetPlayerController(playerId));
			if (controller)
				controller.SRP_AIDeliverDispatch(dispatch.ten_code, dispatch.priority, dispatch.location_grid, dispatch.dispatch_text);
		}
	}

	void SRP_AISyncUnit(int playerId, string agency, bool onDuty)
	{
		if (!Replication.IsServer() || !GetGame())
			return;
		PlayerManager players = GetGame().GetPlayerManager();
		IEntity player = players.GetPlayerControlledEntity(playerId);
		if (!player)
			return;
		ARS_PlayerRoleComponent roles = ARS_PlayerRoleComponent.GetInstance();
		string callsign = roles.GetBadgeNumberServer(playerId);
		if (callsign.IsEmpty())
			callsign = string.Format("%1-%2", agency, playerId);
		vector position = player.GetOrigin();
		SRP_CADUnitStatusRequest payload = new SRP_CADUnitStatusRequest();
		payload.reforgerUid = SCR_PlayerIdentityUtils.GetPlayerIdentityId(player);
		payload.playerName = SRP_CADIdentityBridge.GetRoleplayAlias(player, playerId);
		payload.callsign = callsign;
		payload.agency = agency;
		if (agency == "EMS")
			payload.rank = "Medic";
		else
			payload.rank = "Officer";
		if (onDuty)
			payload.dutyStatus = "10-8";
		else
			payload.dutyStatus = "10-7";
		payload.locationGrid = SCR_MapEntity.GetGridLabel(position);
		payload.worldX = position[0];
		payload.worldZ = position[2];
		SyncUnitStatus(payload);
	}
}

modded class SCR_PlayerController
{
	void SRP_AIDeliverDispatch(string tenCode, string priority, string grid, string dispatchText)
	{
		Rpc(SRP_AIRpcDoShowDispatch, tenCode, priority, grid, dispatchText);
	}

	[RplRpc(RplChannel.Reliable, RplRcver.Owner)]
	protected void SRP_AIRpcDoShowDispatch(string tenCode, string priority, string grid, string dispatchText)
	{
		SCR_ChatPanelManager chat = SCR_ChatPanelManager.GetInstance();
		if (chat)
			chat.OnNewMessage("[AI DISPATCH] " + dispatchText);
		SCR_HintManagerComponent.ShowCustomHint(dispatchText, "AI DISPATCH RADIO · " + priority + " · " + tenCode, 18);
	}
}

modded class ARS_PlayerRoleComponent
{
	override bool SetPoliceDutyServer(int playerId, bool onDuty)
	{
		bool changed = super.SetPoliceDutyServer(playerId, onDuty);
		SRP_CADNetworkManager network = SRP_CADNetworkManager.GetInstance();
		if (changed && network)
			network.SRP_AISyncUnit(playerId, "LEO", onDuty);
		return changed;
	}

	override bool SetEMSDutyServer(int playerId, bool onDuty)
	{
		bool changed = super.SetEMSDutyServer(playerId, onDuty);
		SRP_CADNetworkManager network = SRP_CADNetworkManager.GetInstance();
		if (changed && network)
			network.SRP_AISyncUnit(playerId, "EMS", onDuty);
		return changed;
	}
}

modded class SCR_BaseGameMode
{
	override void OnPlayerSpawned(int playerId, IEntity controlledEntity)
	{
		super.OnPlayerSpawned(playerId, controlledEntity);
		if (Replication.IsServer())
			GetGame().GetCallqueue().CallLater(SRP_AIRefreshUnitTelemetry, 5000, false, playerId, controlledEntity);
	}

	protected void SRP_AIRefreshUnitTelemetry(int playerId, IEntity controlledEntity)
	{
		if (!Replication.IsServer() || !controlledEntity || !GetGame())
			return;
		if (GetGame().GetPlayerManager().GetPlayerControlledEntity(playerId) != controlledEntity)
			return;
		ARS_PlayerRoleComponent roles = ARS_PlayerRoleComponent.GetInstance();
		SRP_CADNetworkManager network = SRP_CADNetworkManager.GetInstance();
		if (roles && network)
		{
			if (roles.IsOnPoliceDutyServer(playerId)) network.SRP_AISyncUnit(playerId, "LEO", true);
			else if (roles.IsOnEMSDutyServer(playerId)) network.SRP_AISyncUnit(playerId, "EMS", true);
		}
		GetGame().GetCallqueue().CallLater(SRP_AIRefreshUnitTelemetry, 15000, false, playerId, controlledEntity);
	}
}

modded class PHN_CellComponent
{
	protected int m_iSRPLastEmergencyAt;

	void SRP_AIRequestEmergency(string serviceType, string details = string.Empty)
	{
		if (!EPF_NetworkUtils.IsOwner(GetOwner()))
			return;
		Rpc(RpcAsk_SRP_AIRequestEmergency, serviceType, details);
		SCR_HintManagerComponent.ShowCustomHint("Call received. Shadow AI Dispatch is classifying and assigning responders.", "RPPhone Emergency", 8);
	}

	[RplRpc(RplChannel.Reliable, RplRcver.Server)]
	protected void RpcAsk_SRP_AIRequestEmergency(string serviceType, string details)
	{
		int now = System.GetTickCount();
		if (m_iSRPLastEmergencyAt > 0 && now - m_iSRPLastEmergencyAt < 15000)
			return;
		m_iSRPLastEmergencyAt = now;
		IEntity player = GetOwner();
		PlayerManager players = GetGame().GetPlayerManager();
		int playerId = players.GetPlayerIdFromControlledEntity(player);
		vector position = player.GetOrigin();
		if (details.IsEmpty())
		{
			if (serviceType == "MEDICAL")
				details = "Medical assistance requested through RPPhone.";
			else
				details = "Police assistance requested through RPPhone.";
		}
		SRP_AIEmergencyRequest payload = new SRP_AIEmergencyRequest();
		payload.callTitle = serviceType + " RPPhone emergency";
		payload.callerName = SRP_CADIdentityBridge.GetRoleplayAlias(player, playerId);
		payload.reforgerUid = SCR_PlayerIdentityUtils.GetPlayerIdentityId(player);
		payload.locationGrid = SCR_MapEntity.GetGridLabel(position);
		payload.description = serviceType + ": " + details;
		payload.serviceType = serviceType;
		payload.worldX = position[0]; payload.worldZ = position[2];
		SRP_CADNetworkManager network = SRP_CADNetworkManager.GetInstance();
		if (network) network.SRP_AISendEmergencyCall(payload);
	}
}

modded class PHN_CellMain
{
	protected bool m_bSRPAIEmergencyConnected;

	override protected void OnMenuOpen()
	{
		super.OnMenuOpen();
		if (m_bSRPAIEmergencyConnected)
			return;
		SCR_ButtonTextComponent button911 = SCR_ButtonTextComponent.GetButtonText("911", GetRootWidget());
		if (button911) button911.m_OnClicked.Insert(SRP_AICallPolice);
		SCR_ButtonTextComponent police = SCR_ButtonTextComponent.GetButtonText("Police", GetRootWidget());
		if (police) police.m_OnClicked.Insert(SRP_AICallPolice);
		SCR_ButtonTextComponent medical = SCR_ButtonTextComponent.GetButtonText("Medical", GetRootWidget());
		if (medical) medical.m_OnClicked.Insert(SRP_AICallMedical);
		SCR_ButtonTextComponent ems = SCR_ButtonTextComponent.GetButtonText("EMS", GetRootWidget());
		if (ems) ems.m_OnClicked.Insert(SRP_AICallMedical);
		m_bSRPAIEmergencyConnected = true;
	}

	protected void SRP_AICallPolice()
	{
		PHN_CellComponent phone = PHN_CellComponent.Cast(plrEnt.FindComponent(PHN_CellComponent));
		if (phone) phone.SRP_AIRequestEmergency("POLICE");
	}

	protected void SRP_AICallMedical()
	{
		PHN_CellComponent phone = PHN_CellComponent.Cast(plrEnt.FindComponent(PHN_CellComponent));
		if (phone) phone.SRP_AIRequestEmergency("MEDICAL");
	}
}

