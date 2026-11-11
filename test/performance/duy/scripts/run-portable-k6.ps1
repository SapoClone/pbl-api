param(
  [Parameter(Mandatory)][ValidateSet('smoke','baseline','load','spike','stress','lines','concurrency','recovery-v2')][string]$Profile,
  [Parameter(Mandatory)][ValidateSet('read','write')][string]$Kind,
  [Parameter(Mandatory)][string]$RunId,
  [int]$ItemCount=1,[int]$SkuOffset=0,[int]$PageLimit=100,
  [string]$ApprovalPath,[string]$PreflightPath,[string]$PriorGatePath,
  [switch]$Execute
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$k6=if($env:K6_PATH){$env:K6_PATH}else{(Get-Command k6 -ErrorAction Stop).Source}
$output=if($env:PERF_OUTPUT_DIR){[IO.Path]::GetFullPath($env:PERF_OUTPUT_DIR)}else{Join-Path $root 'results-local'}
if($RunId -notmatch '^duy-perf-[a-z0-9-]{1,38}$'){throw 'Use a new duy-perf RunId of at most47 characters.'}
if($env:BASE_URL -notmatch '^http://(localhost|127\.0\.0\.1):8080$'){throw 'BASE_URL must be the local Gateway.'}
foreach($name in @('PERF_TENANT_ID','PERF_BRANCH_ID','PERF_WAREHOUSE_ID','PERF_ACTOR_ACCOUNT_ID')){
  $value=[Environment]::GetEnvironmentVariable($name)
  if($value -notmatch '^[0-9a-fA-F-]{36}$'){throw ('Missing UUID configuration: '+$name)}
}
if($env:PERF_TENANT_ID -eq 'a084d7f0-e029-4ce7-bf4e-ddff8e889aba'){throw 'M10 tenant is excluded.'}
$scriptFile=if($Kind -eq 'write'){'stock-receipt.k6.js'}elseif($Profile -in @('spike','recovery-v2')){'stock-levels-recovery-v2.k6.js'}else{'stock-levels.k6.js'}
$scriptPath=Join-Path $PSScriptRoot $scriptFile
if($env:PERF_SKU_IDS_FILE -and -not [IO.Path]::IsPathRooted($env:PERF_SKU_IDS_FILE)){$env:PERF_SKU_IDS_FILE=[IO.Path]::GetFullPath((Join-Path $root $env:PERF_SKU_IDS_FILE)).Replace('\','/')}
$env:PERF_RUN_ID=$RunId;$env:PROFILE=$Profile;$env:PERF_ACK='ISOLATED_LOCAL_TENANT'
$env:PERF_ITEM_COUNT=[string]$ItemCount;$env:PERF_SKU_OFFSET=[string]$SkuOffset
$env:PERF_QTY='0.001';$env:PERF_UNIT_COST='100000';$env:PAGE_LIMIT=[string]$PageLimit;$env:PAGE='1'
if(-not $Execute){
  # Inspect-only uses a placeholder and never calls setup/default functions.
  $savedToken=$env:ACCESS_TOKEN
  try{$env:ACCESS_TOKEN='INSPECT_ONLY';$env:PERF_ENABLE_WRITE='APPROVED_TEST_ONLY';$env:PERF_WRITE_APPROVAL_ID='INSPECT_ONLY';$env:PERF_RECOVERY_APPROVED='APPROVED_READ_RECOVERY_V2'; & $k6 inspect --include-system-env-vars $scriptPath; if($LASTEXITCODE -ne 0){throw 'k6 inspect failed'}}
  finally{$env:ACCESS_TOKEN=$savedToken;Remove-Item Env:PERF_ENABLE_WRITE,Env:PERF_WRITE_APPROVAL_ID,Env:PERF_RECOVERY_APPROVED -ErrorAction SilentlyContinue}
  return
}
if([string]::IsNullOrWhiteSpace($env:ACCESS_TOKEN)){throw 'An approved login must supply ACCESS_TOKEN in memory; this runner does not log in.'}
if(-not $ApprovalPath -or -not $PreflightPath){throw 'Execution requires an approved scope and a fresh read-only preflight file.'}
$approval=Get-Content -Raw -Encoding UTF8 $ApprovalPath|ConvertFrom-Json
if($approval.approval_status -ne 'APPROVED' -or $approval.execution_authorized -ne $true){throw 'PENDING_USER_APPROVAL is not execution authority.'}
foreach($pair in @(@('tenant_id','PERF_TENANT_ID'),@('branch_id','PERF_BRANCH_ID'),@('warehouse_id','PERF_WAREHOUSE_ID'))){if($approval.target.($pair[0]) -ne [Environment]::GetEnvironmentVariable($pair[1])){throw 'Approval target differs from environment.'}}
if($approval.target.gateway -ne $env:BASE_URL){throw 'Gateway approval mismatch.'}
$pre=Get-Content -Raw -Encoding UTF8 $PreflightPath|ConvertFrom-Json
if($pre.status -ne 'PASS' -or ([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($pre.observed_at_utc)).TotalMinutes -gt 5){throw 'Preflight must be PASS and at most5 minutes old.'}
if($pre.tenant_id -ne $env:PERF_TENANT_ID -and $pre.target.tenant_id -ne $env:PERF_TENANT_ID){throw 'Preflight target mismatch.'}
$cap=0
if($Kind -eq 'write'){
  $spec=@($approval.allowed_profiles|Where-Object{$_.run_id -eq $RunId -and $_.profile -eq $Profile -and $_.item_count -eq $ItemCount -and $_.sku_offset -eq $SkuOffset})
  if($spec.Count -ne 1){throw 'Profile/input/RunId tuple is not approved.'}
  $cap=[int]$spec[0].max_posts
  if($cap -ne @{smoke=1;seed=5;load=240;lines=1;concurrency=25}[$Profile] -or $approval.max_write_vus -gt 5 -or $approval.automatic_retry -ne $false){throw 'Write caps/retry guard failed.'}
  if($pre.database.receipts -ne $spec[0].expected_before_receipts -or $pre.database.receipt_items -ne $spec[0].expected_before_items){throw 'Actual checkpoint differs from this profile start oracle.'}
  if($spec[0].expected_before_receipts -gt $approval.existing_checkpoint.receipts){
    if(-not $PriorGatePath){throw 'Prior profile must be verified before continuing.'}
    $gate=Get-Content -Raw -Encoding UTF8 $PriorGatePath|ConvertFrom-Json
    if($gate.status -ne 'PASS' -or $gate.api_verified -ne $true -or $gate.database_verified -ne $true -or $gate.events_verified -ne $true -or $gate.dlq_clear -ne $true){throw 'Prior profile gate is incomplete.'}
  }
}elseif($Profile -eq 'recovery-v2'){
  if($approval.run_id -ne $RunId -or $approval.max_vus -ne 50 -or $approval.maximum_elapsed_with_grace_seconds -ne 90){throw 'Recovery read scope mismatch.'}
}else{
  $readSpec=@($approval.allowed_read_profiles|Where-Object{$_.run_id -eq $RunId -and $_.profile -eq $Profile -and $_.page_limit -eq $PageLimit})
  if($readSpec.Count -ne 1 -or $readSpec[0].max_vus -gt 50 -or ($Profile -eq 'spike' -and $readSpec[0].maximum_elapsed_seconds -ne 90)){throw 'Read profile scope is not approved.'}
}
New-Item -ItemType Directory -Force $output|Out-Null
$journalPath=Join-Path $output ($RunId+'-journal.json')
if(@(Get-ChildItem -LiteralPath $output -Filter ($RunId+'*')).Count -gt 0){throw 'RunId has prior artifacts; never repeat it.'}
$lockPath=Join-Path $output 'approval-execution.lock'
$executionLock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
$used=0
foreach($file in Get-ChildItem -LiteralPath $output -Filter '*-journal.json'){
  $j=Get-Content -Raw -Encoding UTF8 $file.FullName|ConvertFrom-Json
  if($j.approval_id -eq $approval.approval_id){$used += [int]$j.reserved_receipt_posts}
}
if($Kind -eq 'write' -and ($used+$cap -gt $approval.additional_receipt_posts_max -or $approval.existing_checkpoint.receipts+$used+$cap -gt $approval.cumulative_receipt_cap -or $approval.existing_overall_posts+$approval.additional_login_posts_max+$used+$cap -gt $approval.cumulative_total_post_cap)){throw 'Cumulative reservation would exceed approval.'}
$planned=@();for($i=0;$i -lt $cap;$i++){$planned += [ordered]@{request_id=($RunId+'-req'+('{0:D3}' -f $i));status='PLANNED_NOT_SENT'}}
$journal=[ordered]@{run_id=$RunId;approval_id=$approval.approval_id;tenant_id=$env:PERF_TENANT_ID;started_at_utc=[DateTime]::UtcNow.ToString('o');reserved_receipt_posts=$cap;status='RESERVED_BEFORE_K6';planned_requests=$planned;password_or_token_recorded=$false}
function Save-Journal { $tmp=$journalPath+'.tmp';[IO.File]::WriteAllText($tmp,($journal|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false));Move-Item -LiteralPath $tmp -Destination $journalPath -Force }
Save-Journal
$env:PERF_ENABLE_WRITE='APPROVED_TEST_ONLY';$env:PERF_WRITE_APPROVAL_ID=$approval.approval_id
$env:PERF_RECOVERY_APPROVED='APPROVED_READ_RECOVERY_V2';$env:RESULTS_DIR=$output.Replace('\','/')
try{
  $journal.status='K6_STARTED';Save-Journal
  & $k6 run --quiet --include-system-env-vars --out ('json='+ (Join-Path $output ($RunId+'-metrics.jsonl'))) $scriptPath
  $journal['exit_code']=$LASTEXITCODE;$journal.status=if($LASTEXITCODE -eq 0){'AWAITING_READ_ONLY_VERIFICATION'}else{'STOP_RECONCILE_NO_RETRY'}
  Save-Journal
  if($LASTEXITCODE -ne 0){throw 'Workload failed; reconcile read-only before any next profile.'}
}finally{
  Remove-Item Env:PERF_ENABLE_WRITE,Env:PERF_WRITE_APPROVAL_ID,Env:PERF_RECOVERY_APPROVED -ErrorAction SilentlyContinue
  if($executionLock){$executionLock.Dispose();Remove-Item -LiteralPath $lockPath -ErrorAction SilentlyContinue}
}
