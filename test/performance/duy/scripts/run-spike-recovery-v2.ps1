param([Parameter(Mandatory)][string]$RunId,[Parameter(Mandatory)][string]$ApprovalPath,[string]$PreflightPath,[switch]$Execute)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'run-portable-k6.ps1') -Kind read -Profile recovery-v2 -RunId $RunId -ApprovalPath $ApprovalPath -PreflightPath $PreflightPath -Execute:$Execute
