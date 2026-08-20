param(
  [Parameter(Mandatory = $true)]
  [string]$ServerSource
)

$resolvedServer = (Resolve-Path -LiteralPath $ServerSource -ErrorAction Stop).Path
$targetScripts = Join-Path $resolvedServer 'Scripts\Game\ShadowRP\CAD'

if (-not (Test-Path -LiteralPath (Join-Path $resolvedServer 'addon.gproj'))) {
  throw "The selected folder is not a Shadow RP server source project: $resolvedServer"
}

New-Item -ItemType Directory -Path $targetScripts -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ServerIntegration\SRP_AIDispatchServerIntegration.c') -Destination $targetScripts -Force

Write-Host "Shadow AI Dispatch scripts installed into $targetScripts"
Write-Host 'Open the server project in Workbench and compile scripts before publishing.'
