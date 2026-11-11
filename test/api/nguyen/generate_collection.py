"""Build the importable Postman collection from a compact case inventory."""
import json
from pathlib import Path

here = Path(__file__).resolve().parent
items = []
def req(name, method, path, body=None, checks='', auth='token', pre=''):
    headers = [{'key': 'Authorization', 'value': 'Bearer {{' + auth + '}}'}]
    if body is not None: headers.append({'key': 'Content-Type', 'value': 'application/json'})
    entry = {'name': name, 'request': {'method': method, 'header': headers,
             'url': '{{base}}' + path}}
    if body is not None:
        raw = json.dumps(body, ensure_ascii=False)
        # Postman interpolates variables in raw bodies; version must stay JSON numeric.
        for variable in ['primaryVersion', 'cancellableVersion', 'earlyCompleteVersion']:
            raw = raw.replace('"{{' + variable + '}}"', '{{' + variable + '}}')
        entry['request']['body'] = {'mode': 'raw', 'raw': raw}
    events = []
    if pre: events.append({'listen':'prerequest','script':{'exec':pre.splitlines()}})
    if checks: events.append({'listen':'test','script':{'exec':checks.splitlines()}})
    entry['event'] = events
    items.append(entry)

def assert_status(code, extra=''):
    return f"pm.test('HTTP {code}', () => pm.response.to.have.status({code}));\n" + extra
def create(label, qty, channel='ONLINE', role='token'):
    req(f'{label} create {channel} ×{qty}', 'POST', '/sales/api/v1/orders/omnichannel',
        {'branchId':'{{branchId}}','warehouseId':'{{warehouseId}}','channelType':channel,
         'lines':[{'variantId':'{{variantId}}','qty':qty}], 'autoConfirm':False},
        assert_status(201, f"const d=pm.response.json(); pm.test('Order id and code',()=>{{pm.expect(d.id).to.be.a('string');pm.expect(d.code).to.match(/^HD-\\d{{8}}-\\d+$/);}});pm.collectionVariables.set('{label}',d.id);pm.collectionVariables.set('{label}Version',d.version);pm.collectionVariables.set('{label}Code',d.code);"), role)
def action(label, verb, order, body, code, error=None, state=None):
    extra = ''
    if error: extra += f"pm.test('Domain error {error}',()=>pm.expect(pm.response.json().errorCode).to.eql('{error}'));"
    if state: extra += f"pm.test('State {state}',()=>pm.expect(pm.response.json().{state[0]}).to.eql('{state[1]}'));"
    if code == 200: extra += f"pm.collectionVariables.set('{order}Version',pm.response.json().version);"
    req(label, 'POST', f'/sales/api/v1/orders/{{{{{order}}}}}/{verb}', body, assert_status(code, extra))
def detail(label, order, state, stage, save_version=False):
    extra = f"const d=pm.response.json();pm.test('orderStatus={state}, fulfillmentStatus={stage}',()=>{{pm.expect(d.orderStatus).to.eql('{state}');pm.expect(d.fulfillmentStatus).to.eql('{stage}');}});"
    if save_version: extra += f"pm.collectionVariables.set('{order}Version',d.version);"
    req(label,'GET',f'/sales/api/v1/orders/{{{{{order}}}}}',None,assert_status(200,extra))
def stock(label, onhand, reserved):
    # The stock read model can lag the synchronous order response. Poll the same
    # request for at most 45 seconds, and assert only after convergence/timeout.
    extra = f"""const row=pm.response.code===200 && pm.response.json().data.find(x=>x.variantId===pm.environment.get('variantId'));
const ok=!!row && Number(row.onHand)==={onhand} && Number(row.reserved)==={reserved} && Number(row.available)==={onhand-reserved};
const key='retry:{label}', tries=Number(pm.collectionVariables.get(key)||0);
if (!ok && tries<45) {{ pm.collectionVariables.set(key,tries+1); pm.execution.setNextRequest(pm.info.requestName); }}
else {{ pm.collectionVariables.unset(key); pm.test('onHand={onhand}, reserved={reserved}, available={onhand-reserved}',()=>{{pm.expect(row,'seeded SKU').to.exist;pm.expect(Number(row.onHand)).to.eql({onhand});pm.expect(Number(row.reserved)).to.eql({reserved});pm.expect(Number(row.available)).to.eql({onhand-reserved});}}); }}"""
    req(label,'GET','/inventory/api/v1/stock-levels?branchId={{branchId}}',None,assert_status(200,extra))

stock('BASE stock before tests',12,0)
create('primary',2)
detail('TC-NG-01 online new', 'primary','new','unfulfilled',True)
action('TC-NG-02 confirm holds stock','confirm','primary',{'version':'{{primaryVersion}}'},200)
detail('TC-NG-02 confirmed','primary','confirmed','unfulfilled',True)
stock('TC-NG-02 reservation delta',12,2)
action('TC-NG-03 ship before pack','ship','primary',{'version':'{{primaryVersion}}'},409,'ORDER_INVALID_STATE')
detail('TC-NG-03 state unchanged','primary','confirmed','unfulfilled',True)
stock('TC-NG-03 stock unchanged',12,2)
action('TC-NG-04 pack','pack','primary',{'version':'{{primaryVersion}}'},200)
detail('TC-NG-04 packing','primary','confirmed','packing',True)
action('TC-NG-05 pack twice','pack','primary',{'version':'{{primaryVersion}}'},409,'ORDER_INVALID_STATE')
detail('TC-NG-05 state unchanged','primary','confirmed','packing',True)
action('TC-NG-06 stale version','ship','primary',{'version':1},409,'RESOURCE_VERSION_CONFLICT')
detail('TC-NG-06 state unchanged','primary','confirmed','packing',True)
action('TC-NG-07 ship','ship','primary',{'version':'{{primaryVersion}}'},200)
detail('TC-NG-07 shipping','primary','confirmed','shipping',True)
action('TC-NG-08 cancel while shipping','cancel','primary',{'reason':'too late'},409,'ORDER_INVALID_STATE')
detail('TC-NG-08 state unchanged','primary','confirmed','shipping',True)
stock('TC-NG-08 reservation unchanged',12,2)
action('TC-NG-09 delivered, unpaid','complete','primary',{'version':'{{primaryVersion}}'},200)
detail('TC-NG-09 delivered','primary','confirmed','delivered',True)
stock('TC-NG-09 committed stock',10,0)
req('TC-NG-10 payment completes order','POST','/sales/api/v1/orders/{{primary}}/payments',{'method':'transfer','amount':240000},
    assert_status(201),pre="pm.request.headers.add({key:'Idempotency-Key',value:pm.variables.replaceIn('{{$guid}}')});")
detail('TC-NG-10 completed','primary','completed','delivered',True)
action('TC-NG-11 cancel completed','cancel','primary',{'reason':'invalid'},409,'ORDER_ALREADY_COMPLETED')
detail('TC-NG-11 state unchanged','primary','completed','delivered')
stock('TC-NG-11 stock unchanged',10,0)

create('cancellable',3)
action('TC-NG-12 confirm second order','confirm','cancellable',{},200)
stock('TC-NG-12 reserve three',10,3)
action('TC-NG-13 cancel releases hold','cancel','cancellable',{'reason':'customer request'},200)
detail('TC-NG-13 cancelled','cancellable','cancelled','unfulfilled',True)
stock('TC-NG-13 released',10,0)
action('TC-NG-14 confirm cancelled','confirm','cancellable',{},409,'ORDER_INVALID_STATE')
stock('TC-NG-14 stock unchanged',10,0)

create('shortage',11)
action('TC-NG-15 insufficient available','confirm','shortage',{},409,'INSUFFICIENT_STOCK')
detail('TC-NG-15 remains new','shortage','new','unfulfilled')
stock('TC-NG-15 no partial hold',10,0)

create('contentionA',10)
create('contentionB',10)
action('TC-NG-16 first claimant takes last ten','confirm','contentionA',{},200)
action('TC-NG-16 second claimant rejected','confirm','contentionB',{},409,'INSUFFICIENT_STOCK')
stock('TC-NG-16 one hold only',10,10)
action('TC-NG-16 cleanup first hold','cancel','contentionA',{'reason':'cleanup'},200)
stock('TC-NG-16 released',10,0)

create('raceA',10)
create('raceB',10)
req('TC-NG-25 concurrent confirmation, one hold', 'GET', '/sales/api/v1/orders/{{raceA}}', None,
    assert_status(200,"""const ids=['raceA','raceB'].map(k=>pm.collectionVariables.get(k));
const token=pm.environment.get('token'), base=pm.environment.get('base');
let results=[];
ids.forEach((id,index)=>pm.sendRequest({url:base+'/sales/api/v1/orders/'+id+'/confirm',method:'POST',header:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:{mode:'raw',raw:'{}'}},(err,res)=>{
  results[index]={error:err&&String(err),status:res&&res.code,body:res&&res.text()};
  if(results.filter(Boolean).length===2){
    pm.test('One concurrent reservation succeeds, one is refused',()=>pm.expect(results.map(x=>x.status).sort()).to.eql([200,409]));
    pm.test('Refusal is insufficient stock',()=>{const failed=results.find(x=>x.status===409);pm.expect(failed).to.exist;pm.expect(JSON.parse(failed.body).errorCode).to.eql('INSUFFICIENT_STOCK');});
    const winner=results.findIndex(x=>x.status===200);if(winner>=0)pm.collectionVariables.set('raceWinner',ids[winner]);
  }
}));"""))
stock('TC-NG-25 only ten reserved',10,10)
req('TC-NG-25 release winning reservation','POST','/sales/api/v1/orders/{{raceWinner}}/cancel',{'reason':'race cleanup'},assert_status(200))
stock('TC-NG-25 stock restored',10,0)

create('staffOrder',1,role='staffToken')
action('TC-NG-17 staff confirms','confirm','staffOrder',{},200)
req('TC-NG-18 staff cannot cancel','POST','/sales/api/v1/orders/{{staffOrder}}/cancel',{'reason':'forbidden'},assert_status(403),auth='staffToken')
detail('TC-NG-18 still confirmed','staffOrder','confirmed','unfulfilled')
stock('TC-NG-18 hold unchanged',10,1)
action('TC-NG-18 owner cleanup','cancel','staffOrder',{'reason':'cleanup'},200)
req('TC-NG-19 accountant cannot create','POST','/sales/api/v1/orders/omnichannel',
    {'branchId':'{{branchId}}','warehouseId':'{{warehouseId}}','channelType':'ONLINE','lines':[{'variantId':'{{variantId}}','qty':1}]},assert_status(403),auth='accountantToken')
req('TC-NG-20 no token cannot create','POST','/sales/api/v1/orders/omnichannel',
    {'branchId':'{{branchId}}','channelType':'ONLINE','lines':[{'variantId':'{{variantId}}','qty':1}]},assert_status(401),auth='missingToken')

req('TC-NG-21 code uniqueness and observed format','GET','/sales/api/v1/orders/{{contentionB}}',None,
    assert_status(200,"const a=pm.collectionVariables.get('primaryCode'),b=pm.response.json().code;pm.test('Unique per tenant',()=>pm.expect(b).not.eql(a));pm.test('Observed HD-yyyyMMdd-######',()=>pm.expect(b).to.match(/^HD-\\d{8}-\\d{6}$/));"))

# Isolated negative paths run last so a defect cannot corrupt the main lifecycle's stock assertions.
create('earlyComplete',1)
action('TC-NG-22 confirm delivery order','confirm','earlyComplete',{},200)
req('TC-NG-22 complete before ship must reject','POST','/sales/api/v1/orders/{{earlyComplete}}/complete',
    {'version':'{{earlyCompleteVersion}}'},assert_status(409,"pm.test('ORDER_INVALID_STATE',()=>pm.expect(pm.response.json().errorCode).to.eql('ORDER_INVALID_STATE'));"))
req('TC-NG-23 online shortage flagged at creation','POST','/sales/api/v1/orders/omnichannel',
    {'branchId':'{{branchId}}','warehouseId':'{{warehouseId}}','channelType':'ONLINE','lines':[{'variantId':'{{variantId}}','qty':100}], 'autoConfirm':True},
    assert_status(201,"pm.test('Shortage flag and pending order',()=>{const d=pm.response.json();pm.expect(d.shortageDetected).to.eql(true);pm.expect(d.exceptionCode).to.eql('stock_shortage');});"))

req('TC-NG-24 list registers','GET','/sales/api/v1/registers?branchId={{branchId}}',None,
    assert_status(200,"const r=pm.response.json().data[0];pm.test('Register exists',()=>pm.expect(r.id).to.exist);pm.collectionVariables.set('registerId',r.id);"),auth='staffToken')
req('TC-NG-24 open cashier shift','POST','/sales/api/v1/shifts',{'registerId':'{{registerId}}','openingCash':0},
    assert_status(201,"pm.collectionVariables.set('shiftId',pm.response.json().id);"),auth='staffToken')
req('TC-NG-24 POS rejects shortage','POST','/sales/api/v1/pos/checkout',
    {'branchId':'{{branchId}}','warehouseId':'{{warehouseId}}','shiftId':'{{shiftId}}','lines':[{'variantId':'{{variantId}}','qty':100}], 'tenders':[{'method':'CASH','amount':12000000}]},
    assert_status(409,"pm.test('INSUFFICIENT_STOCK',()=>pm.expect(pm.response.json().errorCode).to.eql('INSUFFICIENT_STOCK'));"),auth='staffToken',
    pre="pm.request.headers.add({key:'Idempotency-Key',value:pm.variables.replaceIn('{{$guid}}')});")

req('TC-NG-26 same code may exist in another tenant','GET','/sales/api/v1/orders/{{tenantBOrderId}}',None,
    assert_status(200,"""const d=pm.response.json(), a=pm.collectionVariables.get('primaryCode'), b=pm.environment.get('tenantBCode');
pm.test('Tenant B reads its own first order',()=>{pm.expect(d.id).to.eql(pm.environment.get('tenantBOrderId'));pm.expect(d.code).to.eql(b);});
pm.test('Tenant B sequence starts independently',()=>pm.expect(b).to.match(/^HD-\\d{8}-000001$/));
pm.test('Order code is tenant-scoped',()=>{pm.expect(pm.environment.get('tenantBId')).not.eql(pm.environment.get('tenantId'));if(a.slice(3,11)===b.slice(3,11))pm.expect(b).to.eql(a);});"""),auth='tenantBToken')

collection = {'info':{'name':'Nguyen - API order lifecycle and stock reservation','schema':'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    'description':'Gateway-only API tests. Seeded by run.mjs. TC-NG-16 is sequential contention; TC-NG-25 sends concurrent confirmations. TC-NG-26 checks tenant-scoped codes. BR-05 configurable format has no public configuration contract yet.'},
    'item':items,'variable':[{'key':x,'value':''} for x in ['primary','primaryVersion','primaryCode','cancellable','cancellableVersion','shortage','contentionA','contentionB','raceA','raceB','raceWinner','staffOrder']]}
output = here / 'nguyen.postman_collection.json'
output.write_text(json.dumps(collection,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'{len(items)} requests: {output}')
