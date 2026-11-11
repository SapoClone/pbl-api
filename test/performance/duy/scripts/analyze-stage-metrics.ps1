param(
  [string[]]$RunId = @('duy-perf-20261111-rspike-stages1','duy-perf-20261111-rstress-stages1'),
  [string]$OutputFileName = 'PERF_STAGE_METRICS.json',
  [string]$EvidenceDir,
  [string]$ResultsDir
)

$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $ResultsDir) { $ResultsDir = Join-Path $packageRoot 'results' }
if (-not $EvidenceDir) { $EvidenceDir = Join-Path $packageRoot 'report\performance\evidence' }
$outputPath = Join-Path $evidenceDir $OutputFileName
if (Test-Path -LiteralPath $outputPath) { throw 'Refusing to overwrite prior stage metrics evidence.' }

function Get-NearestRankPercentile {
  param([double[]]$Values,[double]$Percentile)
  if ($Values.Count -eq 0) { return $null }
  $sorted = @($Values | Sort-Object)
  $index = [Math]::Max(0, [Math]::Ceiling($Percentile * $sorted.Count) - 1)
  return [Math]::Round([double]$sorted[$index], 3)
}

$runResults = [System.Collections.Generic.List[object]]::new()
foreach ($id in $RunId) {
  $metaPath = Join-Path $evidenceDir ($id + '-run.json')
  $metricsPath = Join-Path $evidenceDir ($id + '-k6-metrics.jsonl')
  $statsPath = Join-Path $evidenceDir ($id + '-docker-stats.jsonl')
  if (-not (Test-Path -LiteralPath $metaPath) -or -not (Test-Path -LiteralPath $metricsPath)) { throw ('Missing run metadata or raw k6 JSONL for ' + $id) }
  $meta = Get-Content -Raw -Encoding UTF8 -LiteralPath $metaPath | ConvertFrom-Json
  $profile = [string]$meta.profile
  if ($profile -notin @('spike','stress') -or $meta.k6_exit_code -ne 0 -or $meta.timed_out -or $meta.actual_stock_rows -ne 1000) { throw ('Run gate is not PASS for ' + $id) }
  $summaryName = 'read-' + $id + '-' + $profile + '-p1-l100.json'
  $summaryPath = Join-Path $resultsDir $summaryName
  if (-not (Test-Path -LiteralPath $summaryPath)) { throw ('Missing k6 summary for ' + $id) }
  $summary = Get-Content -Raw -Encoding UTF8 -LiteralPath $summaryPath | ConvertFrom-Json
  $boundaries = @($summary.run_metadata.stage_boundaries_seconds)
  if ($boundaries.Count -eq 0) { throw ('No recorded stage boundaries for ' + $id) }
  $durationPoints = [System.Collections.Generic.List[object]]::new()
  $failedPoints = [System.Collections.Generic.List[object]]::new()
  $requestCounts = @{}
  $shapePoints = @{}
  foreach ($line in Get-Content -LiteralPath $metricsPath) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $event = $line | ConvertFrom-Json
    if ($event.type -ne 'Point') { continue }
    $tags = $event.data.tags
    if ($tags.endpoint -ne 'stock-levels' -or [string]::IsNullOrWhiteSpace([string]$tags.stage)) { continue }
    $stage = [string]$tags.stage
    if ($event.metric -eq 'http_req_duration') {
      $durationPoints.Add([pscustomobject]@{ stage=$stage; value=[double]$event.data.value; status=[string]$tags.status })
    } elseif ($event.metric -eq 'http_req_failed') {
      $failedPoints.Add([pscustomobject]@{ stage=$stage; value=[double]$event.data.value })
    } elseif ($event.metric -eq 'stock_levels_business_requests') {
      if (-not $requestCounts.ContainsKey($stage)) { $requestCounts[$stage] = 0 }
      $requestCounts[$stage]++
    } elseif ($event.metric -eq 'stock_levels_response_shape') {
      if (-not $shapePoints.ContainsKey($stage)) { $shapePoints[$stage] = [System.Collections.Generic.List[double]]::new() }
      $shapePoints[$stage].Add([double]$event.data.value)
    }
  }
  $runStart = [DateTimeOffset]::Parse([string]$meta.start_utc).ToUniversalTime()
  $stageResults = [System.Collections.Generic.List[object]]::new()
  foreach ($boundary in $boundaries) {
    $stageName = [string]$boundary.stage
    $latencies = @($durationPoints | Where-Object stage -eq $stageName | ForEach-Object value)
    $failures = @($failedPoints | Where-Object stage -eq $stageName | Where-Object value -gt 0).Count
    $status200 = @($durationPoints | Where-Object { $_.stage -eq $stageName -and $_.status -eq '200' }).Count
    $requestCount = if ($requestCounts.ContainsKey($stageName)) { [int]$requestCounts[$stageName] } else { 0 }
    $shapeValues = if ($shapePoints.ContainsKey($stageName)) { @($shapePoints[$stageName].ToArray()) } else { @() }
    $stageDuration = [double]$boundary.to - [double]$boundary.from
    $expectedVus = switch ($stageName) {
      'ramp_up' { '0-to-50' }; 'hold_50_vu' { '50' }; 'ramp_down' { '50-to-0' }; 'recovery_1_vu' { '1' }
      'ramp_to_10' { '1-to-10' }; 'ramp_to_20' { '10-to-20' }; 'ramp_to_35' { '20-to-35' }; 'ramp_to_50' { '35-to-50' }
      default { '50-to-0' }
    }
    $stageStart = $runStart.AddSeconds([double]$boundary.from)
    $stageEnd = $runStart.AddSeconds([double]$boundary.to)
    $cpuValues = [System.Collections.Generic.List[double]]::new()
    $memoryValues = [System.Collections.Generic.List[double]]::new()
    $statsCount = 0
    if (Test-Path -LiteralPath $statsPath) {
      foreach ($line in Get-Content -LiteralPath $statsPath) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $sample = $line | ConvertFrom-Json
        $sampleTime = [DateTimeOffset]::Parse([string]$sample.sampled_at_utc).ToUniversalTime()
        if ($sampleTime -ge $stageStart -and $sampleTime -lt $stageEnd) {
          $statsCount++
          if ([string]$sample.cpu_percent -match '([0-9]+(?:\.[0-9]+)?)%') { $cpuValues.Add([double]$Matches[1]) }
          if ([string]$sample.memory_percent -match '([0-9]+(?:\.[0-9]+)?)%') { $memoryValues.Add([double]$Matches[1]) }
        }
      }
    }
    $errorRate = if ($requestCount -gt 0) { $failures / $requestCount } else { $null }
    $shapeRate = if ($shapeValues.Count -gt 0) { ($shapeValues | Measure-Object -Average).Average } else { $null }
    $stageStatus = if ($requestCount -eq 0) { 'BLOCKED' } elseif (
      $latencies.Count -eq $requestCount -and $status200 -eq $requestCount -and $errorRate -lt 0.01 -and
      (Get-NearestRankPercentile -Values $latencies -Percentile 0.95) -lt 500 -and $shapeRate -gt 0.99
    ) { 'PASS' } else { 'FAIL' }
    $stageResults.Add([ordered]@{
      stage=$stageName; from_seconds=[double]$boundary.from; to_seconds=[double]$boundary.to; duration_seconds=$stageDuration
      configured_vus=$expectedVus; request_count=$requestCount; throughput_rps=[Math]::Round($requestCount / $stageDuration,3)
      status_200=$status200; non_200_or_transport_errors=$failures; error_rate=if($null -ne $errorRate){[Math]::Round($errorRate,6)}else{$null}
      latency_ms=[ordered]@{p50=(Get-NearestRankPercentile -Values $latencies -Percentile 0.50);p95=(Get-NearestRankPercentile -Values $latencies -Percentile 0.95);p99=(Get-NearestRankPercentile -Values $latencies -Percentile 0.99);max=if($latencies.Count){[Math]::Round(($latencies|Measure-Object -Maximum).Maximum,3)}else{$null}}
      response_shape_rate=if($null -ne $shapeRate){[Math]::Round($shapeRate,6)}else{$null};docker_stats_sample_count=$statsCount
      docker_cpu_percent=[ordered]@{avg=if($cpuValues.Count){[Math]::Round(($cpuValues|Measure-Object -Average).Average,3)}else{$null};max=if($cpuValues.Count){[Math]::Round(($cpuValues|Measure-Object -Maximum).Maximum,3)}else{$null}}
      docker_memory_percent=[ordered]@{avg=if($memoryValues.Count){[Math]::Round(($memoryValues|Measure-Object -Average).Average,3)}else{$null};max=if($memoryValues.Count){[Math]::Round(($memoryValues|Measure-Object -Maximum).Maximum,3)}else{$null}}
      status=$stageStatus
    })
  }
  $totalRequests = 0
  foreach ($stageResult in $stageResults) { $totalRequests += [int]$stageResult['request_count'] }
  $actualBusinessRequests = [int]$summary.metrics.stock_levels_business_requests.values.count
  $allPass = @($stageResults | Where-Object { $_['status'] -ne 'PASS' }).Count -eq 0 -and $totalRequests -eq $actualBusinessRequests
  $runStatus = if (@($stageResults | Where-Object { $_['status'] -eq 'FAIL' }).Count -gt 0) { 'FAIL' } elseif (@($stageResults | Where-Object { $_['status'] -eq 'BLOCKED' }).Count -gt 0) { 'BLOCKED' } else { 'PASS' }
  $runResults.Add([ordered]@{
    run_id=$id;profile=$profile;summary_file=$summaryName;raw_metrics_file=[IO.Path]::GetFileName($metricsPath);docker_stats_file=if(Test-Path $statsPath){[IO.Path]::GetFileName($statsPath)}else{$null}
    start_utc=$meta.start_utc;finish_utc=$meta.finish_utc;profile_duration_seconds=$meta.profile_duration_seconds;max_vus=$meta.max_vus
    expected_stock_rows=$meta.expected_stock_rows;actual_stock_rows=$meta.actual_stock_rows
    total_stage_tagged_requests=$totalRequests;summary_business_request_count=$actualBusinessRequests;setup_gets_excluded=1
    percentile_method='Nearest rank: sorted sample at index ceil(p*N)-1; raw http_req_duration points filtered to endpoint=stock-levels and stage.'
    stages=$stageResults.ToArray();status=$runStatus;request_total_matches_summary=($totalRequests -eq $actualBusinessRequests)
  })
}
$evidence = [ordered]@{
  observed_at_utc=[DateTime]::UtcNow.ToString('o');target_tenant='a669c566-9bea-44fa-b019-3d41d1d27e2f';gateway='http://localhost:8080';backend_sha='9e8044bd7fc16ddc8ec7269a17993ebf07b6d0ff'
  audit_source='k6 raw JSONL points and per-second Docker stats; setup tenant GET excluded from business latency and throughput.'
  latency_and_error_thresholds=[ordered]@{p95_ms_lt=500;error_rate_lt=0.01;response_shape_rate_gt=0.99}
  throughput_method='stage-tagged business request count / configured stage duration seconds; ramp throughput is averaged across its ramp interval.'
  cpu_ram_method='Docker stats samples assigned by sampled_at_utc to the scenario stage time window; percentages are container-level samples, not host-wide resource utilization.'
  runs=$runResults.ToArray();status=if(@($runResults|Where-Object { $_['status'] -eq 'FAIL' }).Count -gt 0){'FAIL'}elseif(@($runResults|Where-Object { $_['status'] -eq 'BLOCKED' }).Count -gt 0){'BLOCKED'}else{'PASS'}
  business_write_requests_sent=0;password_or_token_recorded=$false
}
[IO.File]::WriteAllText($outputPath,($evidence|ConvertTo-Json -Depth 14),[Text.UTF8Encoding]::new($false))
$evidence | ConvertTo-Json -Depth 8
