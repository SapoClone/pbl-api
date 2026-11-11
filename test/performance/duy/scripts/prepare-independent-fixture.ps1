param([Parameter(Mandatory)][string]$ApprovalPath,[switch]$Execute)

$ErrorActionPreference = 'Stop'
$baseUrl = $env:BASE_URL
$runId = $env:PERF_FIXTURE_RUN_ID
$tenantId = $env:PERF_TENANT_ID
$branchId = $env:PERF_BRANCH_ID
$output = if($env:PERF_OUTPUT_DIR){$env:PERF_OUTPUT_DIR}else{Join-Path $PSScriptRoot '..\results-local'}
New-Item -ItemType Directory -Force $output|Out-Null
$evidencePath = Join-Path $output ($runId+'-catalog-setup.json')
if(Test-Path $evidencePath){throw 'Fixture RunId already has a journal; never replay.'}
$approval=Get-Content -Raw -Encoding UTF8 $ApprovalPath|ConvertFrom-Json
if($approval.approval_status -ne 'APPROVED' -or $approval.execution_authorized -ne $true -or $approval.target.tenant_id -ne $tenantId -or $approval.max_catalog_posts -ne 74){throw 'Independent fixture creation needs approved74 catalog POSTs.'}
if($tenantId -in @('a084d7f0-e029-4ce7-bf4e-ddff8e889aba','a669c566-9bea-44fa-b019-3d41d1d27e2f')){throw 'Use a new independently approved tenant, not either historical tenant.'}
if($runId -notmatch '^duy-perf-[a-z0-9-]+$'){throw 'A new fixture run ID is required.'}
if (-not $Execute -or $env:DUY_PERF_PREPARE_ACK -ne 'CREATE_CATALOG_ONLY_NO_STOCK') {
  throw 'This setup script creates catalog products/SKUs through local APIs. Pass -Execute and set DUY_PERF_PREPARE_ACK=CREATE_CATALOG_ONLY_NO_STOCK.'
}
if ($baseUrl -notmatch '^http://(localhost|127\.0\.0\.1):8080$') { throw 'Local Gateway safety guard failed.' }
if([string]::IsNullOrWhiteSpace($env:ACCESS_TOKEN)){throw 'Supply an approved in-memory token.'}
Add-Type -AssemblyName System.Net.Http

$script:clientHandler = [System.Net.Http.HttpClientHandler]::new()
$script:clientHandler.AllowAutoRedirect = $false
$script:client = [System.Net.Http.HttpClient]::new($script:clientHandler)
$script:client.Timeout = [TimeSpan]::FromSeconds(25)
$script:token = $env:ACCESS_TOKEN
$script:journal = [System.Collections.Generic.List[object]]::new()
$script:manifest = [ordered]@{
  run_id = $runId
  status = 'IN_PROGRESS'
  observed_at_utc = [DateTime]::UtcNow.ToString('o')
  gateway = $baseUrl
  database = 'pbl (local Compose)'
  tenant_id = $tenantId
  tenant_subdomain = $runId
  branch_id = $branchId
  catalog_fixture_only = $true
  stock_receipts_created = 0
  stock_balances_created = 0
  password_or_token_recorded = $false
  ids = [ordered]@{ attributes = @(); products = @(); variants = @(); sku_ids = @() }
  request_journal = @()
}

function Save-Evidence {
  $script:manifest.request_journal = @($script:journal.ToArray())
  $json = $script:manifest | ConvertTo-Json -Depth 24
  $tmp=$evidencePath+'.tmp'
  [System.IO.File]::WriteAllText($tmp, $json, [System.Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $tmp -Destination $evidencePath -Force
}

function Invoke-PerfApi {
  param(
    [Parameter(Mandatory)][ValidateSet('GET','POST')][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Step,
    [AllowNull()][object]$Body
  )
  if($Method -eq 'POST' -and @($script:journal|Where-Object method -eq 'POST').Count -ge 74){throw 'Catalog74 POST budget exhausted.'}
  $requestId = [guid]::NewGuid().ToString()
  $started = [DateTime]::UtcNow
  $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($Method), ($baseUrl + $Path))
  $request.Headers.Add('X-Request-Id', $requestId)
  if ($script:token) {
    $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $script:token)
  }
  if ($null -ne $Body) {
    $bodyJson = $Body | ConvertTo-Json -Depth 24 -Compress
    $request.Content = [System.Net.Http.StringContent]::new($bodyJson, [System.Text.Encoding]::UTF8, 'application/json')
  }
  $script:journal.Add([ordered]@{step=$Step;method=$Method;path=$Path;request_id=$requestId;status='PLANNED_BEFORE_SEND'})
  Save-Evidence
  try {
    $response = $script:client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseContentRead).GetAwaiter().GetResult()
    $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $status = [int]$response.StatusCode
    $entry = [ordered]@{ step=$Step; method=$Method; path=$Path; request_id=$requestId; started_at_utc=$started.ToString('o'); completed_at_utc=[DateTime]::UtcNow.ToString('o'); http_status=$status; status=if($response.IsSuccessStatusCode){'SUCCESS'}else{'HTTP_ERROR'} }
    $script:journal[$script:journal.Count-1]=$entry
    Save-Evidence
    if (-not $response.IsSuccessStatusCode) { throw ('Stopped at ' + $Step + ' after HTTP ' + $status + '; request was sent once; no retry.') }
    $parsed = $null
    if (-not [string]::IsNullOrWhiteSpace($content)) { try { $parsed = $content | ConvertFrom-Json } catch { throw ('Stopped at ' + $Step + ': response was not valid JSON; no retry.') } }
    return [pscustomobject]@{ StatusCode=$status; Body=$parsed; RequestId=$requestId }
  } catch {
    if ($script:journal.Count -eq 0 -or $script:journal[$script:journal.Count-1].request_id -ne $requestId) {
      $status = $null
      try { $status = [int]$_.Exception.Response.StatusCode } catch {}
      $script:journal.Add([ordered]@{ step=$Step; method=$Method; path=$Path; request_id=$requestId; started_at_utc=$started.ToString('o'); completed_at_utc=[DateTime]::UtcNow.ToString('o'); http_status=$status; status='TRANSPORT_OR_CLIENT_ERROR'; error_type=$_.Exception.GetType().Name })
      Save-Evidence
    }
    if($script:journal.Count -gt 0 -and $script:journal[$script:journal.Count-1].status -eq 'PLANNED_BEFORE_SEND'){
      $script:journal[$script:journal.Count-1]['status']='OUTCOME_UNKNOWN_NO_RETRY'
      Save-Evidence
    }
    throw
  } finally {
    $request.Dispose()
  }
}

try {
  $current = Invoke-PerfApi -Method GET -Path '/platform/api/v1/tenants/current' -Step 'READ_CURRENT_TENANT' -Body $null
  if($current.Body.id -ne $tenantId){throw 'In-memory token targets a different tenant.'}
  $context = Invoke-PerfApi -Method GET -Path '/platform/api/v1/tenants/current/context' -Step 'READ_OWNER_CONTEXT' -Body $null
  if ($context.Body.me.isOwner -ne $true -or $context.Body.permissions -notcontains 'products.create' -or $context.Body.permissions -notcontains 'inventory.create' -or $context.Body.permissions -notcontains 'inventory.approve') { throw 'Owner context does not meet the required local setup permissions.' }
  $warehouses = Invoke-PerfApi -Method GET -Path '/inventory/api/v1/warehouses' -Step 'READ_WAREHOUSES' -Body $null
  $warehouseRows = if ($warehouses.Body -is [array]) { @($warehouses.Body) } elseif ($warehouses.Body.data) { @($warehouses.Body.data) } else { @($warehouses.Body) }
  $warehouse = $warehouseRows | Where-Object { $_.branchId -eq $branchId -or $_.branch_id -eq $branchId } | Select-Object -First 1
  if (-not $warehouse -or $warehouse.status -ne 'ACTIVE') { throw 'No active warehouse projection found for the isolated branch.' }
  $script:manifest.warehouse_id = $warehouse.id
  $script:manifest.owner_account_id = $env:PERF_ACTOR_ACCOUNT_ID
  $script:manifest.owner_role = 'owner'
  $script:manifest.owner_context_permissions = @($context.Body.permissions)
  $script:manifest.owner_jwt_branches = @('*')
  $script:manifest.warehouse = [ordered]@{ id=$warehouse.id; branch_id=$branchId; status=$warehouse.status; is_default=$warehouse.isDefault }
  Save-Evidence

  $attrA = Invoke-PerfApi -Method POST -Path '/catalog/api/v1/attributes' -Step 'CREATE_ATTRIBUTE_A' -Body @{ name=('Duy Perf Axis A '+$runId) }
  if ($attrA.StatusCode -ne 201 -or -not $attrA.Body.id) { throw 'Attribute A create did not return HTTP 201 and an ID.' }
  $attrB = Invoke-PerfApi -Method POST -Path '/catalog/api/v1/attributes' -Step 'CREATE_ATTRIBUTE_B' -Body @{ name=('Duy Perf Axis B '+$runId) }
  if ($attrB.StatusCode -ne 201 -or -not $attrB.Body.id) { throw 'Attribute B create did not return HTTP 201 and an ID.' }
  $attrIds = @([string]$attrA.Body.id, [string]$attrB.Body.id)
  $script:manifest.ids.attributes = $attrIds
  Save-Evidence

  $valueAIds = [System.Collections.Generic.List[string]]::new()
  for ($i=1; $i -le 50; $i++) {
    $value = 'A{0:D2}' -f $i
    $created = Invoke-PerfApi -Method POST -Path ('/catalog/api/v1/attributes/' + $attrA.Body.id + '/values') -Step ('CREATE_VALUE_A_' + $value) -Body @{ value=$value }
    if ($created.StatusCode -ne 201 -or -not $created.Body.id) { throw ('Attribute value creation failed: ' + $value) }
    $valueAIds.Add([string]$created.Body.id)
    $script:manifest.ids.attribute_a_value_ids = @($valueAIds.ToArray())
    Save-Evidence
  }
  $valueBIds = [System.Collections.Generic.List[string]]::new()
  foreach ($value in @('B01','B02')) {
    $created = Invoke-PerfApi -Method POST -Path ('/catalog/api/v1/attributes/' + $attrB.Body.id + '/values') -Step ('CREATE_VALUE_B_' + $value) -Body @{ value=$value }
    if ($created.StatusCode -ne 201 -or -not $created.Body.id) { throw ('Attribute value creation failed: ' + $value) }
    $valueBIds.Add([string]$created.Body.id)
    $script:manifest.ids.attribute_b_value_ids = @($valueBIds.ToArray())
    Save-Evidence
  }

  $productIds = [System.Collections.Generic.List[string]]::new()
  $variantIds = [System.Collections.Generic.List[string]]::new()
  $skuCodes = [System.Collections.Generic.List[string]]::new()
  for ($i=1; $i -le 10; $i++) {
    $suffix = '{0:D2}' -f $i
    $product = Invoke-PerfApi -Method POST -Path '/catalog/api/v1/products' -Step ('CREATE_PRODUCT_' + $suffix) -Body @{ name=('Duy Perf Product ' + $suffix + (' '+$runId)); baseUnit='PCS'; status='ACTIVE'; attributeIds=$attrIds; createDefaultVariant=$false }
    if ($product.StatusCode -ne 201 -or -not $product.Body.id) { throw ('Product create failed: ' + $suffix) }
    $productIds.Add([string]$product.Body.id)
    $script:manifest.ids.products = @($productIds.ToArray())
    Save-Evidence

    $prefix = 'DPF' + $suffix
    $generated = Invoke-PerfApi -Method POST -Path ('/catalog/api/v1/products/' + $product.Body.id + '/variants/generate') -Step ('GENERATE_VARIANTS_' + $suffix) -Body @{
      skuPrefix=$prefix
      basePrice=100000
      axes=@(
        @{ attributeId=$attrA.Body.id; valueIds=@($valueAIds.ToArray()) },
        @{ attributeId=$attrB.Body.id; valueIds=@($valueBIds.ToArray()) }
      )
    }
    $createdVariants = @($generated.Body)
    if ($generated.StatusCode -ne 201 -or $createdVariants.Count -ne 100) { throw ('Expected exactly 100 generated variants for product ' + $suffix + '; got ' + $createdVariants.Count) }
    foreach ($variant in $createdVariants) {
      if (-not $variant.id -or -not $variant.skuCode) { throw ('Variant response missing ID/SKU for product ' + $suffix) }
      $variantIds.Add([string]$variant.id)
      $skuCodes.Add([string]$variant.skuCode)
    }
    $script:manifest.ids.variants = @($variantIds.ToArray())
    $script:manifest.ids.sku_ids = @($variantIds.ToArray())
    $script:manifest.ids.sku_codes = @($skuCodes.ToArray())
    Save-Evidence
  }

  if ($variantIds.Count -ne 1000 -or $productIds.Count -ne 10) { throw 'Fixture cardinality does not match the requested 10 x 100 setup.' }
  $script:manifest.status = 'CATALOG_FIXTURE_CREATED; STOCK_NOT_SEEDED'
  $script:manifest.product_count = $productIds.Count
  $script:manifest.variant_count = $variantIds.Count
  $script:manifest.distinct_sku_count = @($variantIds | Sort-Object -Unique).Count
  $script:manifest.planned_stock_balance_rows = 1000
  $script:manifest.stock_receipts_created = 0
  $script:manifest.stock_balances_created = 0
  $script:manifest.finished_at_utc = [DateTime]::UtcNow.ToString('o')
  Save-Evidence
  [pscustomobject]@{ status=$script:manifest.status; tenant_id=$tenantId; branch_id=$branchId; warehouse_id=$warehouse.id; product_count=$productIds.Count; variant_count=$variantIds.Count; catalog_post_count=74; setup_request_count=$script:journal.Count; evidence=$evidencePath } | ConvertTo-Json -Depth 4
} finally {
  $script:token = $null
  Remove-Variable password,secure,protected,login -ErrorAction SilentlyContinue
  if ($script:client) { $script:client.Dispose() }
  if ($script:clientHandler) { $script:clientHandler.Dispose() }
}
