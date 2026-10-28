"""Build the combined private report from invoice controls and deduplicated trucking.
No raw data is committed. Existing reports/snapshots are never modified.
"""
import argparse,collections,csv,hashlib,importlib.util,json,re
from datetime import datetime
from decimal import Decimal as D
from pathlib import Path
spec=importlib.util.spec_from_file_location('cotton',Path(__file__).with_name('build-cotton-report.py'));cotton=importlib.util.module_from_spec(spec);spec.loader.exec_module(cotton)
LOCAL=cotton.LOCAL_CODES;LOCATIONS=cotton.LOCATIONS
TRANSPORT={'MAIN':'otr','TERRY':'otr','DAVIS':'otr','CNTR':'dray','DDRAY':'dray'}
WAREHOUSE_FIELDS={'handling':'warehouseHandling','storage':'warehouseStorage','other':'warehouseOther'}
def dec(v):
 if v is None or str(v).strip()=='':return None
 value=D(str(v))
 if not value.is_finite():raise ValueError('Nonfinite amount')
 return value.quantize(D('.01'))
def csvrows(path,encoding='utf-8-sig'):
 with open(path,encoding=encoding,newline='') as f:return list(csv.DictReader(f))
def month(value):
 value=str(value)
 if re.match(r'^\d{4}-\d{2}',value):return value[:7]
 if re.match(r'^\d{8}',value):return value[:4]+'-'+value[4:6]
 raise ValueError('Invalid source date')
def inperiod(value):
 value=str(value);date=value[:10].replace('-','') if '-' in value[:10] else value[:8]
 return bool(re.fullmatch(r'\d{8}',date)) and '20250101'<=date<='20261020'
def assign_unit(pickup,delivery,code):
 units={LOCATIONS[x] for x in [pickup,delivery] if x in LOCATIONS}
 if len(units)>1:return 'Allocation review'
 if units:return next(iter(units))
 return LOCAL.get(code,'Brokerage')
class Families:
 def __init__(self,accounts,warehouse_snapshot):
  self.accounts={x['code']:dict(x) for x in accounts};self.parent={}
  for c in warehouse_snapshot:
   if c['code'].startswith('SHARED:'):continue
   self.accounts.setdefault(c['code'],{'code':c['code'],'name':c['name'],'bridge':c.get('otrCode')})
  self.parent={x:x for x in self.accounts}
  self.unverified=set()
  for code,x in list(self.accounts.items()):
   target=x.get('bridge')
   if not target or target==code:continue
   if target not in self.parent:self.unverified.add(code);continue
   self.parent[self.root(code)]=self.root(target)
  # Preserve verified bridge additions already used by the old report (e.g. Wise).
  for c in warehouse_snapshot:
   a,b=c['code'],c.get('otrCode')
   if a in self.parent and b in self.parent:self.parent[self.root(a)]=self.root(b)
  groups=collections.defaultdict(list)
  for code in self.parent:groups[self.root(code)].append(code)
  self.canonical={}
  for codes in groups.values():
   targets={self.accounts[x].get('bridge') for x in codes}
   key=min(codes,key=lambda x:(x.startswith(('3PL','SHARED:')),x not in targets,x))
   for code in codes:self.canonical[code]=key
 def root(self,code):
  while self.parent[code]!=code:code=self.parent[code]
  return code
 def resolve(self,code):
  key=self.canonical.get(code,code);name=self.accounts.get(key,{}).get('name') or key
  return key,re.sub(r'\s*-\s*3PL$','',name,flags=re.I).strip(),code not in self.canonical or code in self.unverified
class Report:
 def __init__(self,families):self.families=families;self.rows={}
 def add(self,unit,scope,account,period,values,codes=(),review=False):
  key,name,link_review=self.families.resolve(account);g=(unit,scope,key)
  c=self.rows.setdefault(g,{'warehouse':unit,'scope':scope,'code':key,'name':name,'accounts':set(),'codes':set(),'relationshipReview':False,'metrics':collections.defaultdict(D),'months':{}})
  c['accounts'].add(account);c['codes'].update(codes);c['relationshipReview']|=link_review or review
  m=c['months'].setdefault(period,collections.defaultdict(D))
  for target in [c['metrics'],m]:
   for field,value in values.items():target[field]+=D(str(value))
 def finish(self):
  out=[]
  for c in self.rows.values():
   c['accounts']=sorted(c['accounts']);c['codes']=sorted(c['codes']);c['metrics']=dict(c['metrics'])
   c['months']=[{'month':k,**v} for k,v in sorted(c['months'].items())];out.append(c)
  return sorted(out,key=lambda x:(x['name'].lower(),x['warehouse'],x['scope']))
def normalize_csv(x):
 return dict(company=x['company_id'],id=x['order_id'],customer=x['customer_code'],code=x['revenue_code_id'],type=x.get('order_type_id',''),status=x['order_status'],bill=x['bill_date'],revenue=x['total_invoice_revenue'],movement=x['curr_movement_id'],matched=x['matched_current_movement_id'],pay=x['current_movement_override_pay_amt'],pickup=x['pickup_location_id'],delivery=x['delivery_location_id'])
def transport(report,orders,cotton_ids,audit):
 seen={}
 for o in orders:
  if o['company']!='TMS' or not inperiod(o['bill']):raise ValueError('Trucking source scope mismatch')
  k=(o['company'],o['id'])
  if k in seen:
   prior=seen[k]
   if any(str(prior.get(f,''))!=str(o.get(f,'')) for f in ['customer','code','pickup','delivery']) or month(prior['bill'])!=month(o['bill']) or dec(prior['revenue'])!=dec(o['revenue']) or dec(prior.get('pay'))!=dec(o.get('pay')):raise ValueError('Conflicting repeated trucking order')
   audit['duplicate_transport_rows']+=1;continue
  seen[k]=o
 for key,o in seen.items():
  if o['status']=='V':audit['void_transport']+=1;continue
  if o['type']=='ECOTTON':audit['warehouse_orders_not_trucking']+=1;continue
  if o['code'] not in TRANSPORT and o['code'] not in LOCAL:raise ValueError('Unexpected transport revenue code')
  revenue=dec(o['revenue'])
  if revenue is None:raise ValueError('Missing transport revenue')
  kind=TRANSPORT.get(o['code'],'dray');unit=assign_unit(o.get('pickup'),o.get('delivery'),o['code'])
  scope='Cotton' if key in cotton_ids and o['customer'] not in cotton.NON_COTTON_CUSTOMERS else 'Non-Cotton'
  values={kind+'Orders':D(1),kind+'Revenue':revenue,'uniqueTransportOrders':D(1)}
  pay=dec(o.get('pay'));matched=bool(o.get('movement')) and str(o['movement'])==str(o.get('matched'))
  if matched and pay is not None:values.update({kind+'Pay':pay,kind+'RevenueWithPay':revenue})
  else:values[kind+'PayMissing']=D(1)
  if kind=='dray':
   prefix='directDray' if o['code'] in ['CNTR','DDRAY'] else 'localDray'
   values.update({prefix+k[4:]:v for k,v in list(values.items()) if k.startswith('dray')})
  if unit=='Allocation review':values['allocationReviewLoads']=D(1)
  if revenue==0:values[kind+'ZeroRevenueOrders']=D(1)
  report.add(unit,scope,o['customer'],month(o['bill']),values,[o['code']]);audit['transport_orders']+=1
  audit['transport_revenue']+=revenue
 return seen

def warehouse(report,cotton_snapshot,warehouse_snapshot,headers,audit,chassis_ids=()):
 # Cotton contributes warehouse components only; transport is rebuilt from order IDs.
 for c in cotton_snapshot:
  for m in c['months']:
   fields={k:D(str(v)) for k,v in m.items() if k.startswith('warehouse')}
   if not fields.get('warehouseOrders'):continue
   if fields.get('warehouseDetailedOrders')!=fields['warehouseOrders']:raise ValueError('Incomplete cotton warehouse detail')
   if sum(fields.get(k,D(0)) for k in ['warehouseHandling','warehouseStorage','warehouseOther'])!=fields.get('warehouseRevenue'):raise ValueError('Cotton invoice split mismatch')
   fields['invoiceRevenueControl']=fields['warehouseRevenue'];report.add(c['warehouse'],'Cotton',c['code'],m['month'],fields,c['codes'],c['relationshipReview'])
   key=report.families.resolve(c['code'])[0];row=report.rows[(c['warehouse'],'Cotton',key)];row['accounts'].update(c['accounts'])
 control=collections.defaultdict(lambda:{'count':0,'revenue':D(0),'truckInvoices':0});ids=set()
 for h in headers:
  if h['order_id'] in ids:raise ValueError('Repeated warehouse invoice header')
  ids.add(h['order_id']);key=(LOCAL[h['warehouse']],h['customer_code'],month(h['bill_date']))
  g=control[key];g['count']+=1;g['revenue']+=dec(h['total_order_revenue']);g['truckInvoices']+=dec(h['drayage_revenue'])!=0 or h['order_id'] in chassis_ids
 used=set()
 for c in warehouse_snapshot:
  for m in c['months']:
   key=(c['warehouse'],c['code'],m['month']);h=control.get(key)
   if not h:continue
   if key in used:raise ValueError('Repeated warehouse monthly source');
   used.add(key)
   components={new:D(str(m.get(old,0))) for old,new in WAREHOUSE_FIELDS.items()}
   truck=D(str(m.get('drayage',0)))+D(str(m.get('chassis',0)))
   residual=h['revenue']-sum(components.values())-truck
   components['warehouseOther']+=residual
   values={**components,'warehouseOrders':D(h['count']),'warehouseDetailedOrders':D(h['count']),'warehouseRevenue':sum(components.values()),'invoiceRevenueControl':h['revenue']}
   if residual:values['warehouseUnclassifiedRevenue']=residual;audit['warehouse_residual']+=residual
   if truck:
    values['drayRevenue']=truck;values['localDrayRevenue']=truck;values['warehouseTruckBillingRevenue']=truck
    # Cost coverage is unknown on this invoice billing component; never assume zero cost.
    values['warehouseTruckBillingInvoices']=D(h['truckInvoices']);values['drayPayMissing']=D(max(h['truckInvoices'],1));values['localDrayPayMissing']=values['drayPayMissing']
   report.add(c['warehouse'],'Non-Cotton',c['code'],m['month'],values,[],bool(c.get('allocationNote')))
 if used!=control.keys():raise ValueError('Warehouse monthly components missing source invoice group')
 audit['warehouse_invoice_count']=len(ids)+sum(int(c['metrics'].get('warehouseOrders',0)) for c in cotton_snapshot)
 audit['warehouse_invoice_control']=sum(x['revenue'] for x in control.values())+sum(D(str(c['metrics'].get('warehouseRevenue',0))) for c in cotton_snapshot)

def contracts(report,rows,audit):
 explicit=collections.defaultdict(set)
 def reference_unit(x):
  ref=x['Reference number'].lower();units={u for u in ['Savannah','Houston','Dallas'] if u.lower() in ref or (u=='Dallas' and ' dal' in ref)}
  return next(iter(units)) if len(units)==1 else None
 for r in rows:
  unit=reference_unit(r)
  if unit:explicit[r['Customer']].add(unit)
 seen=set()
 for r in rows:
  date=datetime.strptime(r['Bill date'],'%m/%d/%y').date().isoformat()
  if not '2025-01-01'<=date<'2026-10-21':continue
  k=tuple(sorted(r.items()))
  if k in seen:raise ValueError('Duplicate contract invoice')
  seen.add(k);unit=reference_unit(r)
  if unit is None:
   candidates=explicit[r['Customer']];unit=next(iter(candidates)) if len(candidates)==1 else 'Allocation review'
  value=dec(r['Total'])
  if value is None:raise ValueError('Missing contract invoice amount')
  if r['Bill type']=='Credit memo':value=-abs(value)
  elif r['Bill type']!='Invoice':raise ValueError('Unknown contract billing type')
  values={'warehouseStorage':value,'warehouseRevenue':value,'contractStorage':value,'contractDocuments':D(1),'unclassifiedContractRevenue':value}
  if unit=='Allocation review':values['allocationReviewContracts']=D(1)
  report.add(unit,'Unclassified',r['Customer'],date[:7],values,['CONTRACT'])
  audit['contract_documents']+=1;audit['contract_net']+=value

def build(root,cotton_snapshot,warehouse_snapshot,context):
 root=Path(root);context=Path(context)
 manifest=json.loads((context/'manifest.json').read_text())
 if not manifest.get('complete'):raise ValueError('Combined classification context incomplete')
 families=Families(json.loads((context/'accounts.json').read_text()),warehouse_snapshot);report=Report(families)
 audit=collections.defaultdict(D);audit['sources']={};orders=[];cotton_ids=set()
 for name in ['freshdata.csv','terry.csv']:
  source=csvrows(root/'upload'/name);orders.extend(normalize_csv(x) for x in source);audit['sources'][name]=len(source)
 source_orders={(o['company'],o['id']):o for o in orders}
 native_manifest=json.loads((root/'cotton_source_private/manifest.json').read_text())
 if not native_manifest.get('complete'):raise ValueError('Cotton source incomplete')
 for key in [x['key'] for x in native_manifest['sources']]:
  p=json.loads((root/'cotton_source_private'/f'{key}.json').read_text())
  for o in p['orders']:
   if o['commodity']=='COTTON':
    if o['code'] in TRANSPORT:
     original=source_orders.get((o['company'],o['id']))
     if not original or original['customer']!=o['customer'] or original['code']!=o['code'] or dec(original['revenue'])!=dec(o['revenue']):raise ValueError('Native cotton classification differs from trucking source')
    cotton_ids.add((o['company'],o['id']))
   if o['code'] in ['LOCAL','HLOCA','HLOCAL'] and o['type']!='ECOTTON':
    orders.append({**o,'movement':o.get('movementId'),'matched':o.get('matchedMovementId')})
 for code in ['CNTR','TERRY']:
  p=json.loads((context/f'{code}-cotton.json').read_text())
  if not p.get('complete'):raise ValueError('Missing commodity source')
  for o in p['orders']:
   original=source_orders.get((o['company'],o['id']))
   if not original or original['customer']!=o['customer'] or original['code']!=code or dec(original['revenue'])!=dec(o['revenue']):raise ValueError('Enriched cotton classification differs from trucking source')
   cotton_ids.add((o['company'],o['id']))
 headers=csvrows(root/'report_sources/3pl revenue.csv','cp1252')
 dallas={}
 for r in csvrows(root/'upload/dloca.csv'):
  if r['order_type_id']=='3PL' and r['order_status']!='V':dallas[r['order_id']]=r
 headers.extend({'order_id':x['order_id'],'warehouse':'DLOCA','customer_code':x['customer_code'],'bill_date':x['bill_date'],'total_order_revenue':x['total_order_revenue'],'drayage_revenue':x['freight_charge']} for x in dallas.values())
 invoice_ids={x['order_id'] for x in headers}
 if any(o['id'] in invoice_ids for o in orders if o['type']!='ECOTTON'):raise ValueError('Warehouse invoice also present in transport ledger')
 transport(report,orders,cotton_ids,audit)
 chassis_ids={x['order_id'] for x in csvrows(root/'report_sources/storage and handling full period.csv','cp1252') if x['charge_code'] in ['019','HPC','HSPT','SCS','SPC'] and dec(x['charge_amount'])!=0}
 warehouse(report,cotton_snapshot,warehouse_snapshot,headers,audit,chassis_ids)
 contracts(report,csvrows(root/'report_sources/contract storage histroy.csv','cp1252'),audit)
 result=report.finish();totals=collections.defaultdict(D)
 for c in result:
  for k,v in c['metrics'].items():
   if sum(D(str(m.get(k,0))) for m in c['months'])!=D(str(v)):raise ValueError('Monthly control mismatch')
   totals[k]+=v
 revenue=sum(totals[k] for k in ['warehouseRevenue','otrRevenue','drayRevenue'])
 if revenue!=audit['warehouse_invoice_control']+audit['transport_revenue']+audit['contract_net']:raise ValueError('Combined revenue double-counted or missing')
 audit['totals']=dict(totals);audit['combined_revenue']=revenue;audit['rows']=len(result)
 return result,dict(audit)
if __name__=='__main__':
 p=argparse.ArgumentParser()
 for k in ['root','cotton-snapshot','warehouse-snapshot','context-dir','output','audit']:p.add_argument('--'+k,required=True)
 a=p.parse_args();result,audit=build(a.root,json.loads(Path(a.cotton_snapshot).read_text()),json.loads(Path(a.warehouse_snapshot).read_text()),a.context_dir)
 def number(v):
  if isinstance(v,D):return float(v)
  raise TypeError(type(v))
 raw=json.dumps(result,indent=2,default=number)+'\n';Path(a.output).write_text(raw);Path(a.output).chmod(0o600);audit['snapshot_sha256']=hashlib.sha256(raw.encode()).hexdigest();Path(a.audit).write_text(json.dumps(audit,indent=2,default=number)+'\n');Path(a.audit).chmod(0o600)
 print(json.dumps({'rows':len(result),'transport_orders':audit['transport_orders'],'warehouse_invoices':audit['warehouse_invoice_count'],'contract_documents':audit['contract_documents']},default=number))
