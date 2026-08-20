// RPPhone integration. The stock phone keeps its UI; these handlers attach to
// its emergency shortcuts and forward the call through the player-owned CAD component.
modded class PHN_CellMain
{
	protected bool m_SRPCadEmergencyButtonsConnected;

	override protected void OnMenuOpen()
	{
		super.OnMenuOpen();
		if (m_SRPCadEmergencyButtonsConnected)
			return;

		SCR_ButtonTextComponent emergencyButton = SCR_ButtonTextComponent.GetButtonText("911", GetRootWidget());
		if (emergencyButton)
			emergencyButton.m_OnClicked.Insert(SRP_CallPolice911);
		SCR_ButtonTextComponent policeButton = SCR_ButtonTextComponent.GetButtonText("Police", GetRootWidget());
		if (policeButton)
			policeButton.m_OnClicked.Insert(SRP_CallPolice911);
		SCR_ButtonTextComponent medicalButton = SCR_ButtonTextComponent.GetButtonText("Medical", GetRootWidget());
		if (medicalButton)
			medicalButton.m_OnClicked.Insert(SRP_CallMedical911);
		SCR_ButtonTextComponent emsButton = SCR_ButtonTextComponent.GetButtonText("EMS", GetRootWidget());
		if (emsButton)
			emsButton.m_OnClicked.Insert(SRP_CallMedical911);
		m_SRPCadEmergencyButtonsConnected = true;
	}

	protected void SRP_CallPolice911()
	{
		PHN_CellComponent phone = PHN_CellComponent.Cast(plrEnt.FindComponent(PHN_CellComponent));
		if (phone)
			phone.SRP_SubmitEmergency("POLICE", "Police assistance requested through RPPhone emergency services.");
	}

	protected void SRP_CallMedical911()
	{
		PHN_CellComponent phone = PHN_CellComponent.Cast(plrEnt.FindComponent(PHN_CellComponent));
		if (phone)
			phone.SRP_SubmitEmergency("MEDICAL", "Medical assistance requested through RPPhone emergency services.");
	}
}

modded class PHN_CellComponent
{
	void SRP_SubmitEmergency(string serviceType, string description)
	{
		if (!EPF_NetworkUtils.IsOwner(GetOwner()))
			return;
		SRP_AccountLinkComponent cad = SRP_AccountLinkComponent.Cast(GetOwner().FindComponent(SRP_AccountLinkComponent));
		if (!cad)
		{
			SCR_HintManagerComponent.ShowCustomHint("CAD linking component is unavailable on this character.", "RPPhone Emergency", 8);
			return;
		}
		cad.RequestEmergencyCall(description, serviceType);
		SCR_HintManagerComponent.ShowCustomHint("Emergency call sent. AI dispatch is classifying and assigning responders.", "RPPhone Emergency", 8);
	}
}
