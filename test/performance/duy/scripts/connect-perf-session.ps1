param([Parameter(Mandatory)][string]$Email,[string]$TenantId,[Parameter(Mandatory)][string]$RunId,[Parameter(Mandatory)][string]$ApprovalPath,[switch]$Execute)
$ErrorActionPreference='Stop'
if(-not $Execute -or $env:PERF_LOGIN_APPROVED -ne 'YES'){throw 'Login is a POST; requires its separately approved budget and -Execute.'}
$approval=Get-Content -Raw -Encoding UTF8 $ApprovalPath|ConvertFrom-Json
if($approval.approval_status -ne 'APPROVED' -or $approval.execution_authorized -ne $true -or $approval.additional_login_posts_max -lt 1){throw 'An APPROVED login budget is required.'}
if($TenantId -and $approval.target.tenant_id -ne $TenantId){throw 'Approved login tenant differs from requested tenant.'}
if($env:BASE_URL -notmatch '^http://(localhost|127\.0\.0\.1):8080$'){throw 'Local Gateway required.'}
$output=if($env:PERF_OUTPUT_DIR){$env:PERF_OUTPUT_DIR}else{Join-Path $PSScriptRoot '..\results-local'}
New-Item -ItemType Directory -Force $output|Out-Null
$path=Join-Path $output ($RunId+'-login.json')
if(Test-Path $path){throw 'Login RunId already used.'}
$lockPath=Join-Path $output 'approval-execution.lock'
$loginLock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
$priorLogins=@(Get-ChildItem -LiteralPath $output -Filter '*-login.json'|ForEach-Object{Get-Content -Raw -Encoding UTF8 $_.FullName|ConvertFrom-Json}|Where-Object approval_id -eq $approval.approval_id).Count
if($priorLogins+1 -gt $approval.additional_login_posts_max -or $approval.existing_login_posts+$priorLogins+1 -gt $approval.cumulative_login_cap){throw 'Login budget exhausted; no request sent.'}
$id=[guid]::NewGuid().ToString()
$entry=[ordered]@{run_id=$RunId;approval_id=$approval.approval_id;tenant_id=$TenantId;request_id=$id;status='PLANNED_BEFORE_SEND';token_or_password_recorded=$false}
$entry|ConvertTo-Json|Set-Content -Encoding UTF8 $path
$secure=Read-Host 'Approved QA password' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{
  $password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $loginBody=@{email=$Email;password=$password}
  if($TenantId){$loginBody['tenantId']=$TenantId}
  $body=$loginBody|ConvertTo-Json -Compress
  $entry.status='ATTEMPTED_ONCE';$entry|ConvertTo-Json|Set-Content -Encoding UTF8 $path
  $res=Invoke-RestMethod -Method Post -Uri ($env:BASE_URL+'/platform/api/v1/auth/email/login') -Headers @{'X-Request-Id'=$id} -ContentType 'application/json' -Body $body -TimeoutSec 20
  if(-not $res.accessToken -or ($TenantId -and $res.tenantId -ne $TenantId)){throw 'Invalid login response; do not retry.'}
  $env:ACCESS_TOKEN=[string]$res.accessToken;$env:PERF_ACTOR_ACCOUNT_ID=[string]$res.userId
  $entry.status='HTTP_200_TOKEN_MEMORY_ONLY';$entry|ConvertTo-Json|Set-Content -Encoding UTF8 $path
}catch{
  $entry.status='OUTCOME_UNKNOWN_NO_RETRY';$entry|ConvertTo-Json|Set-Content -Encoding UTF8 $path
  throw 'Login failed or outcome is unknown; inspect server state and the sanitized journal. No retry.'
}finally{
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr);Remove-Variable password,body,loginBody,res,secure -ErrorAction SilentlyContinue
  if($loginLock){$loginLock.Dispose();Remove-Item -LiteralPath $lockPath -ErrorAction SilentlyContinue}
}
