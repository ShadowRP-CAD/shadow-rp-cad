param(
  [Parameter(Mandatory = $true)]
  [string]$ServerSource
)

$resolvedServer = (Resolve-Path -LiteralPath $ServerSource -ErrorAction Stop).Path
$targetScripts = Join-Path $resolvedServer 'Scripts\Game\ShadowRP\CAD'
$projectFile = Join-Path $resolvedServer 'addon.gproj'

if (-not (Test-Path -LiteralPath $projectFile)) {
  throw "The selected folder is not a Shadow RP server source project: $resolvedServer"
}

$projectText = Get-Content -Raw -LiteralPath $projectFile
if ($projectText -notmatch 'GUID\s+"37A6F000254E4253"') {
  throw 'This installer only targets Shadow RP | Everon Life (GUID 37A6F000254E4253).'
}

$requiredDependencies = @(
  '65EF7B586691A802', # RPPhone
  'A75A11CE5000E911', # Shadow RP EMS and Police
  '6B39A5D47E2C810F'  # Shadow RP Everon Housing
)
foreach ($dependency in $requiredDependencies) {
  if ($projectText -notmatch [regex]::Escape($dependency)) {
    throw "Required Shadow RP v117 dependency $dependency is missing from addon.gproj."
  }
}

$requiredFiles = @(
  'Scripts\Game\ShadowRP\CAD\SRP_CADNetworkManager.c',
  'Scripts\Game\ShadowRP\CAD\SRP_CADPlayerControllerLink.c',
  'Scripts\Game\Persistence\SRP_PersistentIdentityBank.c'
)
foreach ($relativeFile in $requiredFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $resolvedServer $relativeFile))) {
    throw "The v117 CAD/ATM prerequisite is missing: $relativeFile"
  }
}

New-Item -ItemType Directory -Path $targetScripts -Force | Out-Null
$sourceIntegration = Join-Path $PSScriptRoot 'ServerIntegration\SRP_AIDispatchServerIntegration.c'
$targetIntegration = Join-Path $targetScripts 'SRP_ZZ_AIDispatchServerIntegration.c'
$legacyIntegration = Join-Path $targetScripts 'SRP_AIDispatchServerIntegration.c'
if (Test-Path -LiteralPath $legacyIntegration) {
  $legacyBackupName = 'SRP_AIDispatchServerIntegration.c.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
  Copy-Item -LiteralPath $legacyIntegration -Destination (Join-Path $targetScripts $legacyBackupName)
  Remove-Item -LiteralPath $legacyIntegration
  Write-Host "Replaced the early-loading integration file; backup: $legacyBackupName"
}
if (Test-Path -LiteralPath $targetIntegration) {
  $backupName = 'SRP_ZZ_AIDispatchServerIntegration.c.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
  Copy-Item -LiteralPath $targetIntegration -Destination (Join-Path $targetScripts $backupName)
  Write-Host "Backed up the previous AI integration as $backupName"
}
Copy-Item -LiteralPath $sourceIntegration -Destination $targetIntegration -Force

Write-Host "Shadow AI Dispatch v117 integration installed as SRP_ZZ_AIDispatchServerIntegration.c"
Write-Host 'Verified RPPhone, Police/EMS, Housing, persistent Bank2, and CAD prerequisites.'
Write-Host 'Open the server project in Workbench and compile scripts before publishing.'

