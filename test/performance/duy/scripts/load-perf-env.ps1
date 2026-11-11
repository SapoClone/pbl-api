param([string]$Path=(Join-Path $PSScriptRoot '..\.env'))
$ErrorActionPreference='Stop'
$allowed=@('BASE_URL','PERF_TENANT_ID','PERF_BRANCH_ID','PERF_WAREHOUSE_ID','PERF_ACTOR_ACCOUNT_ID','PERF_FIXTURE_RUN_ID','PERF_SKU_IDS_FILE','PERF_OUTPUT_DIR','PERF_COMPOSE_FILE','PERF_DATABASE','PERF_POSTGRES_USER','K6_PATH')
foreach($line in Get-Content -LiteralPath $Path){
  if($line -match '^\s*(#|$)'){continue}
  if($line -notmatch '^([A-Z0-9_]+)=(.*)$'){throw 'Expected KEY=value.'}
  $key=$Matches[1];$value=$Matches[2].Trim()
  if($key -notin $allowed){throw ('Unknown or secret key is forbidden in this file: '+$key)}
  [Environment]::SetEnvironmentVariable($key,$value,'Process')
}
