"""No-network harness checks, including relocation and refusal of pending scope."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

PORTABLE = ['stock-levels.k6.js','stock-receipt.k6.js','stock-levels-recovery-v2.k6.js','recovery-plan.js',
 'recovery-synthetic.k6.js','write-guards.synthetic.cjs','run-portable-k6.ps1','run-spike-recovery-v2.ps1',
 'connect-perf-session.ps1','new-independent-tenant.ps1','prepare-independent-fixture.ps1','load-perf-env.ps1',
 'verify-portable-checkpoint.ps1','checkpoint.sql','queue-attributes.cjs','analyze-stage-metrics.ps1','write-cap-scheduler.synthetic.k6.js']
p=argparse.ArgumentParser()
p.add_argument('--k6',type=Path,required=True)
p.add_argument('--synthetic',type=Path,required=True)
p.add_argument('--scheduler',type=Path,required=True)
p.add_argument('--approval',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args()
source=Path(__file__).resolve().parent
def run(args,env=None):
    return subprocess.run([str(x) for x in args],env=env,capture_output=True,text=True,encoding='utf-8',errors='replace')
def require(condition,message):
    if not condition: raise AssertionError(message)

node=run(['node',source/'write-guards.synthetic.cjs'])
require(node.returncode==0,node.stderr)
write_checks=json.loads(node.stdout)
points=[json.loads(s) for s in a.synthetic.read_text(encoding='utf-8-sig').splitlines()]
attempts=[x['data'] for x in points if x.get('type')=='Point' and x['metric']=='synthetic_request_attempts']
recovery=[x for x in attempts if x.get('tags',{}).get('stage')=='recovery_1_vu']
require(len(recovery)>=29,'Recovery scheduler did not execute a complete30-second window')
require(len({x['tags']['vu'] for x in recovery})==1,'Recovery used more than one VU')
times=[dt.datetime.fromisoformat(x['time']) for x in recovery]
span=(max(times)-min(times)).total_seconds()
require(span>=28.5,'Recovery synthetic samples do not span the30-second window')
require(not any(x.get('type')=='Point' and x['metric']=='http_reqs' for x in points),'Synthetic unexpectedly sent HTTP')
scheduler=[json.loads(s) for s in a.scheduler.read_text(encoding='utf-8-sig').splitlines()]
admitted=[x['data'] for x in scheduler if x.get('type')=='Point' and x['metric']=='synthetic_admitted']
skipped=[x for x in scheduler if x.get('type')=='Point' and x['metric']=='synthetic_boundary_skipped']
require(len(admitted)==25 and len({x['tags']['request_id'] for x in admitted})==25 and len(skipped)==5,'Actual5-VU iteration scheduler cap failed')
require(not any(x.get('type')=='Point' and x['metric']=='http_reqs' for x in scheduler),'Write scheduler synthetic sent HTTP')
inspect_results=[]
with tempfile.TemporaryDirectory(prefix='duy perf relocated ') as temp:
    root=Path(temp)/'another checkout'/'package'
    scripts=root/'scripts';scripts.mkdir(parents=True)
    for name in PORTABLE: shutil.copy2(source/name,scripts/name)
    fixture=root/'fixtures';fixture.mkdir()
    ids=[f'20000000-0000-4000-8000-{i:012d}' for i in range(1000)]
    sku=fixture/'sku-ids.local.json';sku.write_text(json.dumps({'sku_ids':ids}))
    env=os.environ.copy()
    env.update(BASE_URL='http://localhost:8080',PERF_ACK='ISOLATED_LOCAL_TENANT',ACCESS_TOKEN='SYNTHETIC_ONLY',
      PERF_TENANT_ID=ids[0],PERF_BRANCH_ID=ids[1],PERF_WAREHOUSE_ID=ids[2],PERF_ACTOR_ACCOUNT_ID=ids[3],
      PERF_RUN_ID='duy-perf-synthetic-inspect',PERF_ENABLE_WRITE='APPROVED_TEST_ONLY',PERF_WRITE_APPROVAL_ID='SYNTHETIC_ONLY',
      PERF_RECOVERY_APPROVED='APPROVED_READ_RECOVERY_V2',PERF_SKU_IDS_FILE=str(sku).replace('\\','/'),PERF_UNIT_COST='100000',PERF_QTY='0.001')
    for script,profile,count,offset in [('stock-levels.k6.js','smoke',1,0),('stock-levels.k6.js','baseline',1,0),('stock-levels.k6.js','load',1,0),('stock-levels.k6.js','stress',1,0),('stock-levels-recovery-v2.k6.js','spike',1,0),('stock-receipt.k6.js','lines',10,10),('stock-receipt.k6.js','lines',50,20),('stock-receipt.k6.js','concurrency',1,2),('stock-receipt.k6.js','load',1,1)]:
        env.update(PROFILE=profile,PERF_ITEM_COUNT=str(count),PERF_SKU_OFFSET=str(offset))
        proc=run([a.k6.resolve(),'inspect','--include-system-env-vars',scripts/script],env)
        require(proc.returncode==0,proc.stderr)
        config=json.loads(proc.stdout)
        if script=='stock-levels-recovery-v2.k6.js':
            rec=config['scenarios']['spike_recovery']
            require(rec['executor']=='constant-vus' and rec['vus']==1,'Recovery executor/VU mismatch')
        inspect_results.append({'script':script,'profile':profile,'lines':count,'exit_code':0})
    # Parse every portable PS script from the relocated directory.
    ast_code="$ErrorActionPreference='Stop';$r=@();foreach($f in Get-ChildItem -LiteralPath $env:PERF_VALIDATE_SCRIPT_DIR -Filter '*.ps1'){$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile($f.FullName,[ref]$t,[ref]$e)>$null;$r+=@{file=$f.Name;errors=@($e|ForEach-Object Message)};if($e.Count){throw 'AST failed'}};$r|ConvertTo-Json -Depth 4 -Compress"
    env['PERF_VALIDATE_SCRIPT_DIR']=str(scripts)
    ast=run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-Command',ast_code],env)
    require(ast.returncode==0,ast.stderr)
    ast_results=json.loads(ast.stdout)
    # Even an accidental guard failure cannot launch HTTP: K6_PATH is Python here.
    env.update(K6_PATH=sys.executable,PERF_OUTPUT_DIR=str(root/'results-local'))
    pending=run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',scripts/'run-portable-k6.ps1','-Kind','write','-Profile','lines','-RunId','duy-perf-synthetic-pending','-ItemCount','10','-SkuOffset','10','-ApprovalPath',a.approval.resolve(),'-PreflightPath',root/'unused.json','-Execute'],env)
    require(pending.returncode!=0 and 'PENDING_USER_APPROVAL' in pending.stderr,'Pending scope was not refused')
    env['PERF_LOGIN_APPROVED']='YES'
    login_pending=run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',scripts/'connect-perf-session.ps1','-Email','synthetic@example.test','-TenantId',ids[0],'-RunId','duy-perf-synthetic-login','-ApprovalPath',a.approval.resolve(),'-Execute'],env)
    require(login_pending.returncode!=0 and 'APPROVED login budget' in login_pending.stderr,'Pending login was not refused before prompt/HTTP')
    replay_approval={'approval_id':'SYNTHETIC','approval_status':'APPROVED','execution_authorized':True,'target':{'gateway':env['BASE_URL'],'tenant_id':ids[0],'branch_id':ids[1],'warehouse_id':ids[2]},'max_write_vus':5,'automatic_retry':False,'existing_checkpoint':{'receipts':0},'existing_overall_posts':0,'additional_login_posts_max':0,'additional_receipt_posts_max':1,'cumulative_receipt_cap':1,'cumulative_total_post_cap':1,'allowed_profiles':[{'run_id':'duy-perf-synthetic-replay','profile':'lines','item_count':10,'sku_offset':10,'max_posts':1,'expected_before_receipts':0,'expected_before_items':0}]}
    approval=root/'approved-synthetic.json';approval.write_text(json.dumps(replay_approval))
    preflight=root/'preflight.json';preflight.write_text(json.dumps({'observed_at_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'tenant_id':ids[0],'status':'PASS','database':{'receipts':0,'receipt_items':0}}))
    output=root/'results-local';output.mkdir(exist_ok=True)
    (output/'duy-perf-synthetic-replay-journal.json').write_text('{}')
    replay=run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',scripts/'run-portable-k6.ps1','-Kind','write','-Profile','lines','-RunId','duy-perf-synthetic-replay','-ItemCount','10','-SkuOffset','10','-ApprovalPath',approval,'-PreflightPath',preflight,'-Execute'],env)
    require(replay.returncode!=0 and 'RunId has prior artifacts' in replay.stderr,'RunId replay was not refused')
    # Exercise the real journal writer and new metadata assignment with a dummy
    # executor (Python rejects k6's args). It cannot call the application.
    replay_approval['allowed_profiles'][0]['run_id']='duy-perf-synthetic-journal'
    approval.write_text(json.dumps(replay_approval))
    journal_run=run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',scripts/'run-portable-k6.ps1','-Kind','write','-Profile','lines','-RunId','duy-perf-synthetic-journal','-ItemCount','10','-SkuOffset','10','-ApprovalPath',approval,'-PreflightPath',preflight,'-Execute'],env)
    require(journal_run.returncode!=0 and 'Workload failed' in journal_run.stderr,'Dummy executor failure was not propagated')
    journal_record=json.loads((output/'duy-perf-synthetic-journal-journal.json').read_text(encoding='utf-8-sig'))
    require(journal_record['status']=='STOP_RECONCILE_NO_RETRY' and journal_record['exit_code']!=0 and len(journal_record['planned_requests'])==1,'Actual journal pre/post serialization failed')
    require(not (output/'approval-execution.lock').exists(),'Execution lock was not released after controlled failure')
    replay_approval['allowed_profiles'][0]['run_id']='duy-perf-synthetic-budget'
    replay_approval['additional_receipt_posts_max']=0
    approval.write_text(json.dumps(replay_approval))
    budget=run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',scripts/'run-portable-k6.ps1','-Kind','write','-Profile','lines','-RunId','duy-perf-synthetic-budget','-ItemCount','10','-SkuOffset','10','-ApprovalPath',approval,'-PreflightPath',preflight,'-Execute'],env)
    require(budget.returncode!=0 and 'Cumulative reservation would exceed approval' in budget.stderr,'Cumulative cap refusal failed')
    personal_paths=[name for name in PORTABLE if re.search(r'(?<![A-Za-z])[A-Za-z]:[\\/]',(scripts/name).read_text(encoding='utf-8-sig'))]
    require(not personal_paths,'Portable scripts contain an absolute drive path: '+str(personal_paths))
result={'observed_at_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'status':'PASS',
 'write_actual_function_mock_tests':write_checks,'recovery_synthetic':{'attempts':len(recovery),'unique_vus':1,'sample_span_seconds':round(span,3),'configured_window_seconds':30,'http_requests':0},
 'write_scheduler_synthetic':{'vus':5,'attempted_iterations':30,'admitted':25,'unique_ids':25,'boundary_skipped':5,'http_requests':0},
 'k6_inspect':inspect_results,'powershell_ast':ast_results,'relocated_directory_with_spaces':'PASS','personal_absolute_paths':0,'pending_approval_execution_refused':True,'pending_login_refused':True,'existing_run_id_refused':True,'cumulative_budget_refused':True,'real_journal_writer_dummy_executor':'PASS_PREPLANNED_AND_FINAL_METADATA_PERSISTED','controlled_failure_lock_release':True,
 'source_sha256':{name:hashlib.sha256((source/name).read_bytes()).hexdigest() for name in PORTABLE},
 'live_spike_started':False,'login_posts':0,'receipt_posts':0,'independent_member_live_reproduction':'NOT VERIFIED'}
if a.output.exists(): raise SystemExit('Refusing to overwrite validation evidence')
a.output.write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))
