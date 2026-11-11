"""Build a reviewed QA-only handoff copy; never stages, commits or pushes."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import zipfile

p=argparse.ArgumentParser()
p.add_argument('--workspace',type=Path,default=Path(__file__).resolve().parents[2])
p.add_argument('--repo',type=Path,required=True)
a=p.parse_args();workspace=a.workspace.resolve();repo=a.repo.resolve()
package=workspace/'Duy_Performance_Testing_Package';qa=workspace/'docs/qa';perf=qa/'performance';evidence=perf/'evidence'
dest=repo/'test/performance/duy'
dest.mkdir(parents=True,exist_ok=True)
portable=['stock-levels.k6.js','stock-receipt.k6.js','stock-levels-recovery-v2.k6.js','recovery-plan.js','recovery-synthetic.k6.js','write-cap-scheduler.synthetic.k6.js',
 'write-guards.synthetic.cjs','run-portable-k6.ps1','run-spike-recovery-v2.ps1','connect-perf-session.ps1','new-independent-tenant.ps1','prepare-independent-fixture.ps1',
 'load-perf-env.ps1','verify-portable-checkpoint.ps1','checkpoint.sql','queue-attributes.cjs','analyze-stage-metrics.ps1','audit-recovery.py','validate-correction-v2.py','prepare-git-handoff.py']
mapping={package/'scripts'/name:dest/'scripts'/name for name in portable}
for name in ['README_PERFORMANCE_TESTING.md','REPRODUCIBILITY_GUIDE.md','RUNBOOK_PERFORMANCE_WINDOWS.md','.env.example','.gitignore','.gitattributes']:
    mapping[package/name]=dest/name
for f in (package/'approvals').glob('*.example.json'):mapping[f]=dest/'approvals'/f.name
for name in ['PERF_FINAL_WRITE_APPROVAL_V2.json','PERF_READ_RECOVERY_APPROVAL_V2.json']:
    mapping[perf/name]=dest/'approvals'/name
for f in (package/'results').glob('*'):
    if f.suffix in ('.json','.svg'):mapping[f]=dest/'results'/f.name
for name in ['DUY_PERFORMANCE_TEST_REPORT.md','DUY_PERFORMANCE_HANDOFF.md']:mapping[qa/name]=dest/'report'/name
for name in ['PERF_RESULTS.md','PERF_TEST_CASES.md','PERF_TRACEABILITY.md','PERF_DEFECT_LOG.md','PERF_RUNBOOK.md','DUY_PERFORMANCE_HANDOFF_FINAL.md']:
    mapping[perf/name]=dest/'report/performance'/name
selected=set()
for src in list(mapping):
    if src.suffix=='.md':
        for link in re.findall(r'\]\(([^)]+)\)',src.read_text(encoding='utf-8-sig')):
            f=(src.parent/link).resolve()
            if f.is_file() and f.parent==evidence.resolve():selected.add(f)
for pattern in ['PERF_*V2.json','PERF_CORRECTION_HARNESS_VALIDATION_FINAL_V2.json','PERF_STAGE_METRICS_FINAL.json','PERF_RESUME_FINAL_SUMMARY.json','VERIFIED-duy-perf-20261111-wload.json']:
    selected.update(evidence.glob(pattern))
selected={f for f in selected if f.name not in {'PERF_GIT_EXPORT_SCAN_V2.json','PERF_GIT_HANDOFF_AUDIT_V2.json'}}
for f in selected:mapping[f]=dest/'report/performance/evidence'/f.name

def sanitize(value):
    if isinstance(value,str):
        return value.replace(str(workspace),'[ORIGINAL_WORKSPACE]').replace(str(workspace).replace('\\','/'),'[ORIGINAL_WORKSPACE]')
    if isinstance(value,list):return [sanitize(x) for x in value]
    if isinstance(value,dict):return {k:('[LOCAL_PRIVATE_PATH_REDACTED]' if 'dpapi' in k.lower() and isinstance(v,str) else sanitize(v)) for k,v in value.items()}
    return value

def read_text(src):
    data=src.read_bytes()
    return data.decode('utf-16') if data.startswith((b'\xff\xfe',b'\xfe\xff')) else data.decode('utf-8-sig')

def exported_text(src):
    text=read_text(src)
    if src.suffix=='.json':text=json.dumps(sanitize(json.loads(text)),indent=2,ensure_ascii=False)+'\n'
    if src.suffix=='.md':
        if src.parent==qa:text=text.replace('../../Duy_Performance_Testing_Package/results/','../results/')
        else:text=text.replace('../../../Duy_Performance_Testing_Package/results/','../../results/')
    return '\n'.join(line.rstrip() for line in text.splitlines())+'\n'

patterns={'jwt':re.compile(r'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}'),
 'literal_bearer':re.compile(r'Bearer [A-Za-z0-9_-]{30,}\.'),
 'private_key':re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
 'literal_secret_json':re.compile(r'"(?:password|accessToken|refreshToken)"\s*:\s*"(?!\[REDACTED\]|REDACTED|SYNTHETIC_|STATIC_|INSPECT_ONLY|<)[^"\r\n]{8,}"',re.I)}
findings=[];inventory=[]
for src,target in sorted(mapping.items(),key=lambda x:str(x[1])):
    text=exported_text(src)
    for kind,pattern in patterns.items():
        if pattern.search(text):findings.append({'file':str(target.relative_to(repo)),'rule':kind})
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(text,encoding='utf-8',newline='\n')
    inventory.append({'file':str(target.relative_to(repo)).replace('\\','/'),'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'export_sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size})
if findings:raise SystemExit('Secret patterns found (values withheld): '+json.dumps(findings))
external=[]
for f in sorted(evidence.iterdir()):
    if f.is_file():external.append({'file':f.name,'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
(dest/'EVIDENCE_INVENTORY.json').write_text(json.dumps({'original_evidence_files':external,'original_location':'docs/qa/performance/evidence in original workspace','export_note':'Original evidence untouched; exported JSON copies redact private path metadata. Original/export SHA256 recorded in QA_FILE_INVENTORY.json.'},indent=2),encoding='utf-8')
(dest/'QA_FILE_INVENTORY.json').write_text(json.dumps({'files':inventory,'source_scope':'Portable QA scripts, documentation, pending proposals, selected sanitized historical evidence and results','excluded':['backend business changes','scripts/qa existing untracked work','personal .env/DPAPI','tools/binaries','node_modules'],'staging_performed_by_exporter':False,'committed':False,'pushed':False},indent=2),encoding='utf-8')
# Raw samples are an external artifact; they are not silently added to Git.
archive=package/'results'/'DUY_PERFORMANCE_RAW_ARTIFACTS_V2.zip'
raw_files=[f for f in evidence.iterdir() if f.is_file() and (f.name.startswith('duy-perf-20261111-rspike-stages1') or f.name.startswith('duy-perf-20261111-rstress-stages1') or f.name.startswith('duy-perf-20261111-wload') or f.name.startswith('PERF_RECOVERY_SYNTHETIC_V2') or f.name.startswith('PERF_WRITE_SCHEDULER_SYNTHETIC_V2'))]
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for f in raw_files:
        text=exported_text(f) if f.suffix=='.json' else read_text(f)
        for kind,pattern in patterns.items():
            if pattern.search(text):raise SystemExit('Secret pattern in artifact '+f.name+' rule '+kind)
        z.writestr('evidence/'+f.name,text)
artifact={'file':archive.name,'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'location':'Original performance package results directory; distribute as a separate reviewed artifact','source_files':len(raw_files)}
(dest/'RAW_ARTIFACT.json').write_text(json.dumps(artifact,indent=2),encoding='utf-8')
result={'observed_at_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'status':'PASS','qa_files':len(inventory),'secret_scan':{'rules':list(patterns),'findings':findings,'scanned_export_files':len(inventory),'scanned_raw_artifact_files':len(raw_files),'claim':'Pattern scan only; manual staged review still required'},'artifact':artifact,'git_staging_performed':False,'commit_or_push_performed':False}
(evidence/'PERF_GIT_EXPORT_SCAN_V2.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
(dest/'HANDOFF_SCAN.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
old_scan_copy=dest/'report/performance/evidence/PERF_GIT_EXPORT_SCAN_V2.json'
if old_scan_copy.exists():old_scan_copy.write_text(json.dumps(result,indent=2),encoding='utf-8')
for f in dest.rglob('*'):
    if f.is_file():
        text=read_text(f)
        f.write_text('\n'.join(line.rstrip() for line in text.splitlines())+'\n',encoding='utf-8',newline='\n')
print(json.dumps(result,indent=2))
