param([Parameter(Mandatory)][string]$ExpectedPath,[Parameter(Mandatory)][string]$OutputPath,[string]$RunMetricsPath,[string]$BeforePath,[int]$ExpectedRunPosts=0,[int]$ExpectedLineCount=1,[int[]]$ExpectedLineCounts)
$ErrorActionPreference='Stop'
if(Test-Path $OutputPath){throw 'Refusing to overwrite checkpoint evidence.'}
if($env:PERF_TENANT_ID -notmatch '^[0-9a-fA-F-]{36}$' -or $env:PERF_TENANT_ID -eq 'a084d7f0-e029-4ce7-bf4e-ddff8e889aba'){throw 'Isolated tenant UUID required.'}
if(-not $env:PERF_COMPOSE_FILE -or -not (Test-Path $env:PERF_COMPOSE_FILE)){throw 'PERF_COMPOSE_FILE is required.'}
$expectedRecord=Get-Content -Raw -Encoding UTF8 $ExpectedPath|ConvertFrom-Json
$expected=if($expectedRecord.existing_checkpoint){$expectedRecord.existing_checkpoint}else{$expectedRecord}
$dbName=if($env:PERF_DATABASE){$env:PERF_DATABASE}else{'pbl'}
$dbUser=if($env:PERF_POSTGRES_USER){$env:PERF_POSTGRES_USER}else{'postgres'}
$sql=Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'checkpoint.sql')
$raw=$sql|& docker compose -f $env:PERF_COMPOSE_FILE exec -T postgres psql -U $dbUser -d $dbName -X -A -t -v ON_ERROR_STOP=1 -v ('perf_tenant='+$env:PERF_TENANT_ID) 2>&1
if($LASTEXITCODE -ne 0){throw 'SELECT READ ONLY checkpoint failed.'}
$db=([string](@($raw|Where-Object{([string]$_).Trim().StartsWith('{')})[-1]))|ConvertFrom-Json
$dbPass=$db.database -eq $dbName -and $db.transaction_read_only -eq 'on' -and $db.posted_receipts -eq $db.receipts -and $db.wac_bad_rows -eq 0
foreach($key in @('receipts','receipt_items','ledger','balances','on_hand_total','valuation_total','stock_changed','stock_received')){if([decimal]$db.$key -ne [decimal]$expected.$key){$dbPass=$false}}
$queueSource=Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'queue-attributes.cjs')
$queueRaw=$queueSource|& docker compose -f $env:PERF_COMPOSE_FILE exec -T inventory node - 2>&1
if($LASTEXITCODE -ne 0){throw 'Queue attributes query failed.'}
$queue=([string](@($queueRaw|Where-Object{([string]$_).Trim().StartsWith('{')})[-1]))|ConvertFrom-Json
$dlqs=@($queue.queues|Where-Object name -like '*-events-dlq')
$main=@($queue.queues|Where-Object name -match '^[a-z]+-events$')
$dlqPass=$dlqs.Count -eq 8 -and @($dlqs|Where-Object{($_.visible+$_.in_flight+$_.delayed) -ne 0}).Count -eq 0
$queuePass=$queue.queue_count -eq 17 -and $main.Count -eq 8 -and @($main|Where-Object{($_.visible+$_.in_flight+$_.delayed) -ne 0 -or $_.visibility_timeout -ne 30 -or $_.redrive_policy -notmatch 'maxReceiveCount.:3'}).Count -eq 0
$apiStatus='NOT_RUN_NO_IN_MEMORY_TOKEN';$apiPass=$false;$stocks=@();$receiptChecks=@();$receiptPass=($ExpectedRunPosts -eq 0)
if(-not [string]::IsNullOrWhiteSpace($env:ACCESS_TOKEN)){
  if($env:BASE_URL -notmatch '^http://(localhost|127\.0\.0\.1):8080$'){throw 'Local Gateway required.'}
  $headers=@{Authorization=('Bearer '+$env:ACCESS_TOKEN)}
  $current=Invoke-RestMethod ($env:BASE_URL+'/platform/api/v1/tenants/current') -Headers $headers -TimeoutSec 15
  if($current.id -ne $env:PERF_TENANT_ID){throw 'Authenticated tenant mismatch.'}
  $context=Invoke-RestMethod ($env:BASE_URL+'/platform/api/v1/tenants/current/context') -Headers $headers -TimeoutSec 15
  if($context.permissions -notcontains 'inventory.view' -or @($context.branches|Where-Object id -eq $env:PERF_BRANCH_ID).Count -ne 1){throw 'Read permission or branch scope mismatch.'}
  $levels=Invoke-RestMethod ($env:BASE_URL+'/inventory/api/v1/stock-levels?branchId='+$env:PERF_BRANCH_ID+'&page=1&limit=100') -Headers $headers -TimeoutSec 15
  $page=1
  do{
    $res=Invoke-RestMethod ($env:BASE_URL+'/inventory/api/v1/stocks?warehouseId='+$env:PERF_WAREHOUSE_ID+'&page='+$page+'&limit=100') -Headers $headers -TimeoutSec 15
    $stocks+=@($res.data);$page++
    if($page -gt 1000){throw 'Pagination bound exceeded.'}
  }while($stocks.Count -lt [int]$res.pagination.totalRecords)
  $qty=[decimal]0;$valuation=[decimal]0
  foreach($row in $stocks){$qty += [decimal]$row.onHandQty;$valuation += [decimal]$row.valuationAmount}
  $apiPass=$stocks.Count -eq $db.balances -and [int]$levels.pagination.totalRecords -eq $db.balances -and $qty -eq [decimal]$db.on_hand_total -and $valuation -eq [decimal]$db.valuation_total -and @($stocks|Where-Object{[decimal]$_.avgUnitCost -ne 100000}).Count -eq 0
  $apiStatus=if($apiPass){'PASS'}else{'FAIL'}
  if($ExpectedRunPosts -gt 0){
    if(-not $RunMetricsPath -or -not $BeforePath){throw 'Run verification needs raw request metrics and a before snapshot.'}
    $observed=@(Get-Content $RunMetricsPath|ForEach-Object{$_|ConvertFrom-Json}|Where-Object{$_.type -eq 'Point' -and $_.metric -eq 'stock_receipt_request_journal'}|Sort-Object {$_.data.tags.request_id})
    $ids=@($observed|ForEach-Object{$_.data.tags.receipt_id})
    $receiptPass=$ids.Count -eq $ExpectedRunPosts -and @($ids|Sort-Object -Unique).Count -eq $ExpectedRunPosts
    $deltas=@{}
    if($ExpectedLineCounts -and $ExpectedLineCounts.Count -ne $ExpectedRunPosts){throw 'Expected line-count array must match expected POST count.'}
    $receiptIndex=0
    foreach($id in $ids){
      $lineOracle=if($ExpectedLineCounts){$ExpectedLineCounts[$receiptIndex]}else{$ExpectedLineCount}
      $r=Invoke-RestMethod ($env:BASE_URL+'/inventory/api/v1/stock-receipts/'+$id) -Headers $headers -TimeoutSec 15
      $moveRows=@();$movePage=1
      do{
        $mov=Invoke-RestMethod ($env:BASE_URL+'/inventory/api/v1/stock-movements?warehouseId='+$env:PERF_WAREHOUSE_ID+'&referenceType=STOCK_RECEIPT&referenceId='+$id+'&page='+$movePage+'&limit=100') -Headers $headers -TimeoutSec 15
        $moveRows+=@($mov.data);$movePage++
        if($movePage -gt 4){throw 'Receipt movement pagination exceeded expected DTO bound.'}
      }while($moveRows.Count -lt [int]$mov.pagination.totalRecords)
      $ok=$r.status -eq 'POSTED' -and @($r.items).Count -eq $lineOracle -and [int]$mov.pagination.totalRecords -eq $lineOracle
      if($moveRows.Count -ne $lineOracle -or @($moveRows|Where-Object{$_.referenceId -ne $id -or $_.movementType -ne 'PURCHASE_RECEIPT' -or [decimal]$_.qtyDelta -ne [decimal]0.001 -or $_.actorId -ne $env:PERF_ACTOR_ACCOUNT_ID}).Count -gt 0 -or @($moveRows.id|Sort-Object -Unique).Count -ne $moveRows.Count){$ok=$false}
      foreach($item in $r.items){if([decimal]$item.qty -ne [decimal]0.001 -or [decimal]$item.unitCost -ne 100000){$ok=$false};if(-not $deltas.ContainsKey($item.skuId)){$deltas[$item.skuId]=[decimal]0};$deltas[$item.skuId]+=[decimal]$item.qty}
      $receiptChecks+=@{id=$id;status=$r.status;items=@($r.items).Count;ledger=[int]$mov.pagination.totalRecords;pass=$ok}
      if(-not $ok){$receiptPass=$false}
      $receiptIndex++
    }
    $before=Get-Content -Raw -Encoding UTF8 $BeforePath|ConvertFrom-Json
    foreach($row in $stocks){$old=@($before.stocks|Where-Object skuId -eq $row.skuId|Select-Object -First 1);$oldQty=if($old.Count){[decimal]$old[0].onHandQty}else{[decimal]0};$delta=if($deltas.ContainsKey($row.skuId)){$deltas[$row.skuId]}else{[decimal]0};if([decimal]$row.onHandQty -ne $oldQty+$delta){$receiptPass=$false}}
  }
}
$result=[ordered]@{observed_at_utc=[DateTime]::UtcNow.ToString('o');tenant_id=$env:PERF_TENANT_ID;database=$db;api_status=$apiStatus;api_verified=$apiPass;database_verified=$dbPass;events_verified=($db.bad_event_rows -eq 0);dlq_clear=$dlqPass;queue_topology_verified=$queuePass;stocks=$stocks;receipts=$receiptChecks;run_integrity_verified=$receiptPass;status=if($apiPass -and $dbPass -and $receiptPass -and $db.bad_event_rows -eq 0 -and $queuePass -and $dlqPass){'PASS'}else{'BLOCKED'};login_posts=0;receipt_posts=0;secrets_recorded=$false}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath),($result|ConvertTo-Json -Depth 15),[Text.UTF8Encoding]::new($false))
[pscustomobject]$result|Select-Object status,api_status,database_verified,events_verified,dlq_clear,login_posts,receipt_posts|ConvertTo-Json
