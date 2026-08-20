// Shadow RP CAD bridge - server-side asynchronous HTTP transport.
// Attach this component to the replicated game-mode entity and configure its attributes.

[BaseContainerProps()]
class SRP_CADNetworkManagerClass : ScriptComponentClass
{
}

class SRP_CADLinkResponse : JsonApiStruct
{
	string token;
	string expiresAt;

	void SRP_CADLinkResponse()
	{
		RegV("token");
		RegV("expiresAt");
	}
}

class SRP_CADOnboardingResponse : JsonApiStruct
{
	bool linked;
	bool showPrompt;
	string token;
	string expiresAt;

	void SRP_CADOnboardingResponse()
	{
		RegV("linked");
		RegV("showPrompt");
		RegV("token");
		RegV("expiresAt");
	}
}

class SRP_CADLinkRequest : JsonApiStruct
{
	string apiKey;
	string reforgerUid;
	string playerName;

	void SRP_CADLinkRequest()
	{
		RegV("apiKey");
		RegV("reforgerUid");
		RegV("playerName");
	}
}

class SRP_CADUnitStatusRequest : JsonApiStruct
{
	string apiKey;
	string reforgerUid;
	string playerName;
	string callsign;
	string agency;
	string rank;
	string dutyStatus;
	string locationGrid;
	float worldX;
	float worldZ;

	void SRP_CADUnitStatusRequest()
	{
		RegV("apiKey"); RegV("reforgerUid"); RegV("playerName"); RegV("callsign");
		RegV("agency"); RegV("rank"); RegV("dutyStatus"); RegV("locationGrid");
		RegV("worldX"); RegV("worldZ");
	}
}

class SRP_CADEmergencyRequest : JsonApiStruct
{
	string apiKey;
	string callTitle;
	string callerName;
	string locationGrid;
	string description;
	string serviceType;
	float worldX;
	float worldZ;

	void SRP_CADEmergencyRequest()
	{
		RegV("apiKey"); RegV("callTitle"); RegV("callerName"); RegV("locationGrid");
		RegV("description"); RegV("serviceType"); RegV("worldX"); RegV("worldZ");
	}
}

class SRP_CADDispatchResponse : JsonApiStruct
{
	int id;
	string call_title;
	string location_grid;
	string ten_code;
	string dispatch_text;
	string dispatch_agency;
	string priority;
	ref array<string> assigned_units;

	void SRP_CADDispatchResponse()
	{
		RegV("id"); RegV("call_title"); RegV("location_grid"); RegV("ten_code");
		RegV("dispatch_text"); RegV("dispatch_agency"); RegV("priority"); RegV("assigned_units");
		assigned_units = {};
	}
}

class SRP_CADRestCallback : RestCallback
{
	protected SRP_CADNetworkManager m_Manager;
	protected SRP_AccountLinkComponent m_LinkTarget;
	protected string m_RequestName;

	void Initialise(SRP_CADNetworkManager manager, string requestName, SRP_AccountLinkComponent linkTarget = null)
	{
		m_Manager = manager;
		m_RequestName = requestName;
		m_LinkTarget = linkTarget;
		SetOnSuccess(Callback_OnSuccess);
		SetOnError(Callback_OnError);
	}

	protected void Callback_OnSuccess(RestCallback callback)
	{
		string data = callback.GetData();
		PrintFormat("[ShadowRP CAD] %1 succeeded (HTTP %2)", m_RequestName, callback.GetHttpCode());

		if (m_LinkTarget)
		{
			if (m_RequestName == "link.onboarding")
			{
				SRP_CADOnboardingResponse onboarding = new SRP_CADOnboardingResponse();
				onboarding.ExpandFromRAW(data);
				if (onboarding.showPrompt && !onboarding.token.IsEmpty())
					m_LinkTarget.DeliverOnboardingCode(onboarding.token);
			}
			else
			{
				SRP_CADLinkResponse response = new SRP_CADLinkResponse();
				response.ExpandFromRAW(data);
				if (response.token.IsEmpty())
					m_LinkTarget.DeliverLinkResult(false, "CAD returned an invalid linking response.");
				else
					m_LinkTarget.DeliverLinkResult(true, response.token);
			}
		}

		if (m_Manager && m_RequestName == "call.911")
		{
			SRP_CADDispatchResponse dispatch = new SRP_CADDispatchResponse();
			dispatch.ExpandFromRAW(data);
			if (!dispatch.dispatch_text.IsEmpty())
				m_Manager.BroadcastEmergencyDispatch(dispatch);
		}

		if (m_Manager)
			m_Manager.ReleaseCallback(this);
	}

	protected void Callback_OnError(RestCallback callback)
	{
		PrintFormat("[ShadowRP CAD] %1 failed (HTTP %2, REST result %3)", m_RequestName, callback.GetHttpCode(), callback.GetRestResult());
		if (m_LinkTarget && m_RequestName != "link.onboarding")
			m_LinkTarget.DeliverLinkResult(false, "The CAD bridge is unavailable. Please try again.");
		if (m_Manager)
			m_Manager.ReleaseCallback(this);
	}
}

class SRP_CADNetworkManager : ScriptComponent
{
	[Attribute("https://cad-api.example.com", UIWidgets.EditBox, "Backend origin without trailing slash")]
	protected string m_ApiBaseUrl;

	[Attribute("CHANGE_ME", UIWidgets.EditBox, "Must match INTERNAL_API_KEY on the backend")]
	protected string m_InternalApiKey;

	protected static SRP_CADNetworkManager s_Instance;
	protected ref array<ref SRP_CADRestCallback> m_ActiveCallbacks = {};

	static SRP_CADNetworkManager GetInstance()
	{
		return s_Instance;
	}

	override void OnPostInit(IEntity owner)
	{
		super.OnPostInit(owner);
		s_Instance = this;
	}

	void ~SRP_CADNetworkManager()
	{
		if (s_Instance == this)
			s_Instance = null;
	}

	void GenerateLinkToken(SRP_AccountLinkComponent target, string reforgerUid, string playerName)
	{
		SRP_CADLinkRequest payload = new SRP_CADLinkRequest();
		payload.apiKey = m_InternalApiKey;
		payload.reforgerUid = reforgerUid;
		payload.playerName = playerName;
		payload.Pack();
		Post("api/link/generate", payload.AsString(), "link.generate", target);
	}

	void CheckFirstJoinOnboarding(SRP_AccountLinkComponent target, string reforgerUid, string playerName)
	{
		SRP_CADLinkRequest payload = new SRP_CADLinkRequest();
		payload.apiKey = m_InternalApiKey;
		payload.reforgerUid = reforgerUid;
		payload.playerName = playerName;
		payload.Pack();
		Post("api/link/onboarding", payload.AsString(), "link.onboarding", target);
	}

	void SyncUnitStatus(SRP_CADUnitStatusRequest payload)
	{
		payload.apiKey = m_InternalApiKey;
		payload.Pack();
		Post("api/cad/unit-status", payload.AsString(), "unit.status");
	}

	void SendEmergencyCall(SRP_CADEmergencyRequest payload)
	{
		payload.apiKey = m_InternalApiKey;
		payload.Pack();
		Post("api/cad/call911", payload.AsString(), "call.911");
	}

	void BroadcastEmergencyDispatch(SRP_CADDispatchResponse dispatch)
	{
		if (!Replication.IsServer() || !GetGame())
			return;

		PlayerManager playerManager = GetGame().GetPlayerManager();
		array<int> playerIds = {};
		playerManager.GetPlayers(playerIds);
		foreach (int playerId : playerIds)
		{
			IEntity player = playerManager.GetPlayerControlledEntity(playerId);
			if (!player)
				continue;
			SRP_DutySyncComponent duty = SRP_DutySyncComponent.Cast(player.FindComponent(SRP_DutySyncComponent));
			SRP_AccountLinkComponent link = SRP_AccountLinkComponent.Cast(player.FindComponent(SRP_AccountLinkComponent));
			if (link && duty && duty.AcceptsDispatch(dispatch.dispatch_agency))
				link.DeliverEmergencyDispatch(dispatch.ten_code, dispatch.priority, dispatch.location_grid, dispatch.dispatch_text);
		}
	}

	protected void Post(string path, string json, string requestName, SRP_AccountLinkComponent linkTarget = null)
	{
		if (m_ApiBaseUrl.IsEmpty() || m_InternalApiKey == "CHANGE_ME")
		{
			Print("[ShadowRP CAD] Network manager is not configured.", LogLevel.ERROR);
			if (linkTarget)
				linkTarget.DeliverLinkResult(false, "CAD bridge is not configured.");
			return;
		}

		RestContext context = GetGame().GetRestApi().GetContext(m_ApiBaseUrl + "/");
		context.SetTimeout(10);
		SRP_CADRestCallback callback = new SRP_CADRestCallback();
		callback.Initialise(this, requestName, linkTarget);
		m_ActiveCallbacks.Insert(callback); // callbacks must remain referenced until completion
		context.POST(callback, path, json);
	}

	void ReleaseCallback(SRP_CADRestCallback callback)
	{
		m_ActiveCallbacks.RemoveItem(callback);
	}
}
