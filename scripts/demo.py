#!/usr/bin/env python3
"""Testnet-only preparation. Keys/logs live outside the checkout; tracked output is public."""
import argparse, base64, datetime, hashlib, json, os, pathlib, re, secrets, shutil, subprocess, sys, time
from decimal import Decimal
ROOT=pathlib.Path(__file__).resolve().parents[1]
STATE=pathlib.Path(os.environ.get('RUG_DEMO_HOME',str(pathlib.Path.home()/'.local/share/rug-dealer-demo'))).expanduser().resolve()
if STATE==ROOT or ROOT in STATE.parents: raise SystemExit('RUG_DEMO_HOME must be outside the repository.')
STATE.mkdir(parents=True,exist_ok=True);STATE.chmod(0o700)
CLI=os.environ.get('STELLAR_CLI',shutil.which('stellar') or 'stellar')
ISSUER='GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
ASSET='USDC:'+ISSUER
CONFIG=STATE/'config';CONFIG.mkdir(exist_ok=True);CONFIG.chmod(0o700)
MANIFEST=ROOT/'frontend/demo/deployment.json'
RECEIPTS=ROOT/'frontend/public/demo-receipts.json'
EVENTS=[]
def save(path,data): path.write_text(json.dumps(data,indent=2)+'\n')
def http(url):
 p=subprocess.run(['curl','--silent','--show-error','--connect-timeout','10','--max-time','20','--retry','2','--retry-all-errors','--retry-delay','1','-w','\n%{http_code}',url],capture_output=True,text=True,check=True)
 body,code=p.stdout.rsplit('\n',1)
 if code=='404':return None
 if code!='200':raise RuntimeError('HTTP '+code+' from '+url+': '+body[:200])
 return json.loads(body)
def account(address):return http('https://horizon-testnet.stellar.org/accounts/'+address)
def usdc(address):
 a=account(address)
 if not a:return Decimal(0)
 return next((Decimal(b['balance']) for b in a['balances'] if b.get('asset_code')=='USDC' and b.get('asset_issuer')==ISSUER),Decimal(0))
def run(label,args):
 p=subprocess.run([CLI,'--config-dir',str(CONFIG),'--no-cache']+args,capture_output=True,text=True,timeout=180)
 stamp=datetime.datetime.now(datetime.timezone.utc).isoformat().replace(':','-')
 (STATE/(stamp+'-'+label+'.log')).write_text(p.stdout+'\n'+p.stderr)
 hashes=re.findall(r'Signing transaction: ([a-f0-9]{64})',p.stderr)
 entry={'action':label,'hashes':hashes,'exit_code':p.returncode,'arguments':args}
 EVENTS.append(entry)
 with (STATE/'transactions.jsonl').open('a') as out:out.write(json.dumps(entry)+'\n')
 print(label+': '+(' '.join('https://stellar.expert/explorer/testnet/tx/'+h for h in hashes) or p.stdout.strip()[:180]),flush=True)
 if p.returncode:raise RuntimeError(p.stderr or p.stdout)
 return p.stdout.strip()
def setup():
 addresses={}
 for role in ['warehouse','weaver','lender','dealer','buyer']:
  alias='demo-'+role
  if not (CONFIG/'identity'/(alias+'.toml')).exists():run('create-'+role,['keys','generate',alias,'--network','testnet','--fund'])
  address=run('address-'+role,['keys','address',alias]);addresses[role]=address
  if not account(address):run('fund-xlm-'+role,['keys','fund',alias,'--network','testnet'])
  line=next((b for b in account(address)['balances'] if b.get('asset_code')=='USDC' and b.get('asset_issuer')==ISSUER),None)
  if not line:run('trust-'+role,['tx','new','change-trust','--source',alias,'--network','testnet','--line',ASSET])
 assert len(set(addresses.values()))==5
 save(STATE/'accounts.json',addresses)
 return addresses
def topup(role,address,target):
 needed=Decimal(target)-usdc(address)
 if needed>0:run('topup-'+role,['tx','new','path-payment-strict-receive','--source','demo-'+role,'--network','testnet','--send-asset','native','--send-max','50000000000','--destination',address,'--dest-asset',ASSET,'--dest-amount',str(int(needed*10_000_000))])
def config():
 d=json.loads(MANIFEST.read_text());a=json.loads((STATE/'accounts.json').read_text())
 if not d.get('contract'):raise RuntimeError('Run deploy first.')
 if d['accounts']!=a:raise RuntimeError('The local identities do not match this deployment. Select its original RUG_DEMO_HOME or deploy a new instance.')
 return d,a
def invoke(d,label,role,method,id,args=None,view=False):
 return run(label,['contract','invoke','--id',d['contract'],'--source','demo-'+role,'--network','testnet']+(['--send','no'] if view else [])+['--',method]+(['--id',id] if id else [])+(args or []))
def receipt(d,id):return json.loads(invoke(d,'read-'+id[:8],'warehouse','get_receipt',id,view=True))
def snapshot(a):return {role:str(usdc(address)) for role,address in a.items()}
def deploy(args):
 a=setup()
 for role,n in [('lender',80),('buyer',60),('dealer',40),('weaver',20)]:topup(role,a[role],n)
 token=run('usdc-id',['contract','id','asset','--network','testnet','--asset',ASSET])
 wasm=ROOT/'target/wasm32v1-none/release/rug_loan.wasm'
 if not wasm.exists():raise RuntimeError('Run stellar contract build --locked first.')
 contract=run('deploy',['contract','deploy','--wasm',str(wasm),'--network','testnet','--source','demo-warehouse','--','--warehouse',a['warehouse'],'--token',token])
 d={'network':'testnet','contract':contract,'usdc':token,'issuer':ISSUER,'accounts':a,'receipts':[]}
 save(MANIFEST,d);save(RECEIPTS,[]);save(STATE/'deployment.json',d);save(ROOT/'docs/full-demo-deployment.json',{'deployment':d,'transactions':EVENTS,'wasm_sha256':hashlib.sha256(wasm.read_bytes()).hexdigest()})
 print('New deployment configured. Rebuild/restart the frontend after deployment.',flush=True)
def prepare(args):
 d,a=config()
 for role,n in [('lender',80),('buyer',60),('dealer',40),('weaver',20)]:topup(role,a[role],n)
 entries=[]
 for scenario in ['normal-sale','direct-repayment','dealer-default']:
  id=secrets.token_hex(32);duration=args.default_duration if scenario=='dealer-default' else args.duration
  invoke(d,scenario+'-register','warehouse','register_receipt',id,['--weaver',a['weaver']])
  terms={'advance':'80000000','lender_due':'90000000','custody_fee':'10000000','fallback_price':'100000000','duration_secs':duration,'lender':a['lender'],'dealer':a['dealer']}
  if args.stage in ['accepted','ready']:
   invoke(d,scenario+'-accept','weaver','accept_terms',id,['--terms',json.dumps(terms)])
  if args.stage=='ready':
   invoke(d,scenario+'-commit','dealer','accept_fallback',id,['--terms',json.dumps(terms)])
   invoke(d,scenario+'-fund','lender','fund_loan',id)
   invoke(d,scenario+'-approve','weaver','approve_sale',id,['--price','150000000'])
  entries.append({'id':id,'name':scenario.replace('-',' ').title()+' · '+id[:6],'description':'Illustrative warehouse-held rug for the '+scenario+' demo.','scenario':scenario})
 existing=json.loads(RECEIPTS.read_text()) if RECEIPTS.exists() else []
 save(RECEIPTS,entries+existing);save(STATE/'latest-preparation.json',{'stage':args.stage,'receipts':entries,'transactions':EVENTS})
 save(ROOT/'docs/full-demo-preparation.json',{'stage':args.stage,'receipts':entries,'transactions':EVENTS})
 print('Fresh independent receipts ready. URLs:')
 for entry in entries:print('http://127.0.0.1:3000/warehouse?receipt='+entry['id'])
def exercise(args):
 d,a=config();prep=json.loads((STATE/'latest-preparation.json').read_text())
 if prep['stage']!='ready':raise RuntimeError('Run prepare --stage ready before exercise.')
 results=[]
 for item in prep['receipts']:
  id=item['id'];r=receipt(d,id)
  if r['stage'] not in ['Active','Overdue']:raise RuntimeError('Receipt already consumed. Run prepare again.')
  before=snapshot(a);save(STATE/('exercise-'+id+'.json'),{'before_usdc':before});scenario=item['scenario']
  if scenario=='normal-sale':method,role,params,stage,recipient='buy','buyer',['--buyer',a['buyer'],'--payment','150000000'],'SaleSettled',a['buyer']
  elif scenario=='direct-repayment':method,role,params,stage,recipient='repay','weaver',[],'Repaid',a['weaver']
  else:
   while receipt(d,id)['stage']!='Overdue':
    print('Waiting for the ledger deadline (10-second intervals)…',flush=True);time.sleep(10)
   method,role,params,stage,recipient='dealer_buy','dealer',[],'DealerPurchased',a['dealer']
  invoke(d,scenario+'-settle',role,method,id,params);after=snapshot(a);final=receipt(d,id)
  expected={'warehouse':Decimal(1),'lender':Decimal(9),'weaver':Decimal(5 if role=='buyer' else -10 if role=='weaver' else 0),'buyer':Decimal(-15 if role=='buyer' else 0),'dealer':Decimal(-10 if role=='dealer' else 0)}
  deltas={k:Decimal(after[k])-Decimal(before[k]) for k in a};assert deltas==expected,(scenario,deltas)
  assert final['stage']==stage and final['ready_for_pickup'] and final['pickup_recipient']==recipient
  assert final['buyer']==(None if role=='weaver' else recipient)
  results.append({'scenario':scenario,'receipt_id':id,'before_usdc':before,'after_usdc':after,'settlement_delta_usdc':{k:str(v) for k,v in deltas.items()},'final_receipt':final})
 save(ROOT/'docs/full-demo-testnet.json',{'contract':d['contract'],'network':'testnet','outcomes':results,'transactions':EVENTS})
 print('Verified all three outcomes, exact balances, and immutable pickup recipients.',flush=True)
def verify(args):
 # Strictly read-only network calls: no setup, topup, or settlement entry point.
 d,a=config();prep=json.loads((STATE/'latest-preparation.json').read_text())
 record=pathlib.Path(args.record) if args.record else ROOT/'docs/full-demo-testnet.json'
 if args.record or (prep['stage']!='ready' and record.exists()):
  completed=json.loads(record.read_text());assert completed['contract']==d['contract'],'Verification record belongs to another deployment.'
  prep={'receipts':[{'id':r['receipt_id'],'scenario':r['scenario']} for r in completed['outcomes']]}
 log=[json.loads(line) for line in (STATE/'transactions.jsonl').read_text().splitlines()]
 results=[]
 for item in prep['receipts']:
  id=item['id'];scenario=item['scenario'];match=None
  for event in reversed(log):
   if event['action']!=scenario+'-settle' or not event['hashes']:continue
   hash=event['hashes'][-1]
   tx=http('https://horizon-testnet.stellar.org/transactions/'+hash)
   if not tx or not tx['successful']:continue
   ops=http('https://horizon-testnet.stellar.org/transactions/'+hash+'/operations')['_embedded']['records']
   if len(ops)!=1:continue
   op=ops[0]
   if base64.b64decode(op['parameters'][2]['value'])[8:].hex()!=id:continue
   match=(hash,op);break
  if not match:raise RuntimeError('No matching confirmed settlement found for '+id+'. No payment was attempted.')
  hash,op=match
  expected={'warehouse':Decimal(1),'lender':Decimal(9),'weaver':Decimal(5 if scenario=='normal-sale' else -10 if scenario=='direct-repayment' else 0),'buyer':Decimal(-15 if scenario=='normal-sale' else 0),'dealer':Decimal(-10 if scenario=='dealer-default' else 0)}
  deltas={addr:Decimal(0) for addr in list(a.values())+[d['contract']]}
  for change in op['asset_balance_changes']:
   if change.get('asset_code')=='USDC' and change.get('asset_issuer')==ISSUER:
    assert change['from'] in deltas and change['to'] in deltas
    deltas[change['from']]-=Decimal(change['amount']);deltas[change['to']]+=Decimal(change['amount'])
  assert {role:deltas[address] for role,address in a.items()}==expected
  assert deltas[d['contract']]==0
  final=receipt(d,id)
  stage={'normal-sale':'SaleSettled','direct-repayment':'Repaid','dealer-default':'DealerPurchased'}[scenario]
  recipient=a[{'normal-sale':'buyer','direct-repayment':'weaver','dealer-default':'dealer'}[scenario]]
  assert final['stage']==stage and final['ready_for_pickup'] and final['pickup_recipient']==recipient
  assert final['buyer']==(None if scenario=='direct-repayment' else recipient)
  results.append({'scenario':scenario,'receipt_id':id,'transaction_hash':hash,'settlement_delta_usdc':{k:str(v) for k,v in expected.items()},'final_receipt':final})
  save(ROOT/'docs/full-demo-testnet.json',{'contract':d['contract'],'network':'testnet','outcomes':results,'verification':'Read-only Horizon transaction/transfer checks and get_receipt simulations. No payment submitted by verify.'})
  print('Verified '+scenario+': https://stellar.expert/explorer/testnet/tx/'+hash,flush=True)
 print('Verified all three outcomes with read-only checks.',flush=True)
def fund_wallet(args):
 d,a=config();address=args.address
 if not re.fullmatch('G[A-Z2-7]{55}',address):raise RuntimeError('Supply a public G-address.')
 if not account(address):
  if not http('https://friendbot.stellar.org/?addr='+address):raise RuntimeError('Friendbot did not fund the account.')
 line=next((b for b in account(address)['balances'] if b.get('asset_code')=='USDC' and b.get('asset_issuer')==ISSUER and b.get('is_authorized')),None)
 if not line:raise RuntimeError('Test XLM is ready. Connect this wallet on the website and approve the Circle testnet USDC trustline; then rerun fund-wallet.')
 needed=Decimal(args.amount)-usdc(address)
 if needed<=0:print('Wallet already has at least the requested test USDC balance.');return
 if address==a['buyer']:topup('buyer',address,args.amount);return
 topup('buyer',a['buyer'],needed)
 run('fund-public-wallet',['tx','new','payment','--source','demo-buyer','--network','testnet','--destination',address,'--asset',ASSET,'--amount',str(int(needed*10_000_000))])
 assert usdc(address)>=Decimal(args.amount)
 print('Verified recipient test USDC balance:',usdc(address))
parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
sub.add_parser('deploy');p=sub.add_parser('prepare');p.add_argument('--stage',choices=['held','accepted','ready'],default='held');p.add_argument('--duration',type=int,default=900);p.add_argument('--default-duration',type=int,default=60)
sub.add_parser('exercise');p=sub.add_parser('verify');p.add_argument('--record');p=sub.add_parser('fund-wallet');p.add_argument('address');p.add_argument('--amount',default='15')
args=parser.parse_args()
if args.command=='prepare' and not all(30<=v<=86400 for v in (args.duration,args.default_duration)): parser.error('Durations must be 30 to 86400 seconds.')
if args.command=='fund-wallet' and (not re.fullmatch(r'\d+(\.\d{1,7})?',args.amount) or Decimal(args.amount)<=0): parser.error('Use a positive amount with at most seven decimal places.')
try:{'deploy':deploy,'prepare':prepare,'exercise':exercise,'verify':verify,'fund-wallet':fund_wallet}[args.command](args)
except (RuntimeError,subprocess.SubprocessError,AssertionError) as e:raise SystemExit(str(e))
