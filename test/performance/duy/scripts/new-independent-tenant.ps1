param([Parameter(Mandatory)][string]$Name,[Parameter(Mandatory)][string]$Subdomain,[Parameter(Mandatory)][string]$RunId,[Parameter(Mandatory)][string]$ApprovalPath,[switch]$Execute)
$ErrorActionPreference='Stop'
if(-not $Execute){throw 'Tenant creation is a persistent API POST; requires approval and -Execute.'}
$approval=Get-Content -Raw -Encoding UTF8 $ApprovalPath|ConvertFrom-Json
if($approval.approval_status -ne 'APPROVED' -or $approval.execution_authorized -ne $true -or $approval.max_tenant_posts -ne 1){throw 'One independent tenant POST must be explicitly approved.'}
if($env:BASE_URL -notmatch '^http://(localhost|127\.0\.0\.1):8080$' -or [string]::IsNullOrWhiteSpace($env:ACCESS_TOKEN)){throw 'Local Gateway and in-memory account token required.'}
if($Subdomain -notmatch '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'){throw 'Use a unique3-30 character lowercase subdomain.'}
if($RunId -notmatch '^duy-perf-[a-z0-9-]+$'){throw 'A new RunId is required.'}
$out=if($env:PERF_OUTPUT_DIR){$env:PERF_OUTPUT_DIR}else{Join-Path $PSScriptRoot '..\results-local'}
New-Item -ItemType Directory -Force $out|Out-Null
$path=Join-Path $out ($RunId+'-tenant.json');if(Test-Path $path){throw 'RunId already used.'}
$id=[guid]::NewGuid().ToString();$j=[ordered]@{run_id=$RunId;request_id=$id;status='PLANNED_BEFORE_SEND';name=$Name;subdomain=$Subdomain;secret_recorded=$false}
$j|ConvertTo-Json|Set-Content -Encoding UTF8 $path
try{
  $j.status='ATTEMPTED_ONCE';$j|ConvertTo-Json|Set-Content -Encoding UTF8 $path
  $r=Invoke-RestMethod -Method Post -Uri ($env:BASE_URL+'/platform/api/v1/tenants') -Headers @{Authorization=('Bearer '+$env:ACCESS_TOKEN);'X-Request-Id'=$id} -ContentType 'application/json' -Body (@{name=$Name;subdomain=$Subdomain;defaultBranchName='Performance QA'}|ConvertTo-Json) -TimeoutSec 25
  if(-not $r.tenant.id -or -not $r.auth.accessToken){throw 'Ambiguous tenant response; reconcile read-only, no retry.'}
  $env:ACCESS_TOKEN=[string]$r.auth.accessToken;$env:PERF_TENANT_ID=[string]$r.tenant.id;$env:PERF_ACTOR_ACCOUNT_ID=[string]$r.auth.userId
  $j['tenant_id']=$env:PERF_TENANT_ID;$j.status='CREATED_TOKEN_MEMORY_ONLY';$j|ConvertTo-Json|Set-Content -Encoding UTF8 $path
}catch{
  $j.status='OUTCOME_UNKNOWN_NO_RETRY';$j|ConvertTo-Json|Set-Content -Encoding UTF8 $path
  throw 'Tenant request failed or outcome is unknown; reconcile read-only and do not retry.'
}finally{Remove-Variable r -ErrorAction SilentlyContinue}
