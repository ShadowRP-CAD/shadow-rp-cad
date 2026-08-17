[BaseContainerProps()]
class SRP_EmergencyCallAction : ScriptedUserAction
{
	[Attribute("Emergency assistance requested from an in-game call point.", UIWidgets.EditBox, "Text sent to dispatch")]
	protected string m_Description;

	override void PerformAction(IEntity pOwnerEntity, IEntity pUserEntity)
	{
		SRP_AccountLinkComponent linkComponent = SRP_AccountLinkComponent.Cast(pUserEntity.FindComponent(SRP_AccountLinkComponent));
		if (!linkComponent)
		{
			SCR_HintManagerComponent.ShowCustomHint("Your player prefab is missing SRP_AccountLinkComponent.", "Shadow RP 911", 8);
			return;
		}

		linkComponent.RequestEmergencyCall(m_Description);
		SCR_HintManagerComponent.ShowCustomHint("Your emergency call was sent to dispatch.", "Shadow RP 911", 8);
	}

	override bool CanBeShownScript(IEntity user)
	{
		return user != null;
	}

	override bool CanBePerformedScript(IEntity user)
	{
		return user != null;
	}

	override bool GetActionNameScript(out string outName)
	{
		outName = "Call Shadow RP 911";
		return true;
	}

	override bool HasLocalEffectOnlyScript()
	{
		return true;
	}
}

// Optional interaction action for an account-link kiosk/terminal.
[BaseContainerProps()]
class SRP_AccountLinkAction : ScriptedUserAction
{
	override void PerformAction(IEntity pOwnerEntity, IEntity pUserEntity)
	{
		SRP_AccountLinkComponent component = SRP_AccountLinkComponent.Cast(pUserEntity.FindComponent(SRP_AccountLinkComponent));
		if (component)
			component.RequestAccountLink();
	}

	override bool CanBeShownScript(IEntity user)
	{
		return user != null;
	}

	override bool CanBePerformedScript(IEntity user)
	{
		return user != null;
	}

	override bool GetActionNameScript(out string outName)
	{
		outName = "Generate Shadow RP CAD link code";
		return true;
	}

	override bool HasLocalEffectOnlyScript()
	{
		return true;
	}
}
