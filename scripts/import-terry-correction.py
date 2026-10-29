"""Add a verified missing MAIN relationship and full-period TERRY data.
Private input/output paths are supplied explicitly. Existing metrics are retained.
"""
import argparse, collections, copy, csv, importlib.util, json
from decimal import Decimal as D
from pathlib import Path
spec=importlib.util.spec_from_file_location('expand',Path(__file__).with_name('expand-warehouse-trucking.py'))
engine=importlib.util.module_from_spec(spec);spec.loader.exec_module(engine)

def read(path):
 with open(path,encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))

def correct(snapshot,main,terry,link):
 out=copy.deepcopy(snapshot)
 for c in out:
  if not c['code'].startswith('SHARED:'):c.pop('allocationNote',None)
 key=(link['warehouse'],link['warehouse_customer_code'])
 if any((c['warehouse'],c['code'])==key for c in out):raise ValueError('Missing relationship already exists; do not append twice')
 eligible=[];seen=set()
 for x in main:
  if x['customer_code']!=link['trucking_customer_code'] or x['revenue_code_id']!='MAIN':continue
  oid=(x['company_id'],x['order_id'])
  if oid in seen:raise ValueError('Duplicate MAIN order')
  seen.add(oid)
  if x['company_id']!='TMS' or not '2025-01-01'<=x['bill_date']<'2026-10-21':raise ValueError('Invalid MAIN source scope')
  if x['order_status']=='V' or x['order_type_id']=='ECOTTON':continue
  locations={engine.LOCATIONS[v] for v in [x['pickup_location_id'],x['delivery_location_id']] if v in engine.LOCATIONS}
  if not locations:continue
  if locations!={link['warehouse']}:raise ValueError('Missing MAIN relationship has ambiguous warehouse')
  if not x['current_movement_override_pay_amt'] or x['curr_movement_id']!=x['matched_current_movement_id']:raise ValueError('MAIN movement/pay missing')
  eligible.append(x)
 c={'warehouse':link['warehouse'],'code':link['warehouse_customer_code'],'name':link['name'],
    'otrCode':link['trucking_customer_code'],'warehouseDataAvailable':False,'metrics':{},'months':[]}
 months=collections.defaultdict(lambda:collections.defaultdict(D))
 for x in eligible:
  m=months[x['bill_date'][:7]]
  for k,v in [('otrLoads',D(1)),('otrRevenue',D(x['total_invoice_revenue'])),('otrPay',D(x['current_movement_override_pay_amt']))]:m[k]+=v
 c['months']=[{'month':m,**values} for m,values in sorted(months.items())]
 c['metrics']={k:sum((v.get(k,D(0)) for v in months.values()),D(0)) for k in ['otrLoads','otrRevenue','otrPay']}
 out.append(c)
 unique={};bridges={}
 ignore={'warehouse_customer_code','warehouse_customer_name','warehouse_trucking_bridge'}
 for x in terry:
  if x['revenue_code_id']!='TERRY':raise ValueError('Unexpected TERRY source code')
  key=(x['company_id'],x['order_id']);core={k:v for k,v in x.items() if k not in ignore}
  if key in unique and {k:v for k,v in unique[key].items() if k not in ignore}!=core:raise ValueError('Conflicting repeated TERRY order')
  unique[key]=x
  if x['warehouse_customer_code']:
   if x['warehouse_trucking_bridge']!=x['customer_code']:raise ValueError('TERRY customer bridge mismatch')
   bridge_key=(x['warehouse_customer_code'],x['customer_code'])
   b={'warehouse_customer_code':x['warehouse_customer_code'],'warehouse_customer_name':x['warehouse_customer_name'],'trucking_customer_code':x['customer_code']}
   if bridge_key in bridges and bridges[bridge_key]!=b:raise ValueError('Conflicting bridge names')
   bridges[bridge_key]=b
 result,audit=engine.expand(out,list(unique.values()),list(bridges.values()))
 audit['missing_MAIN_orders']=len(eligible)
 audit['terry_source_rows']=len(terry);audit['terry_unique_orders']=len(unique)
 return result,audit

if __name__=='__main__':
 p=argparse.ArgumentParser()
 for k in ['snapshot','main','terry','link','output','audit']:p.add_argument('--'+k,required=True)
 a=p.parse_args()
 out,audit=correct(json.loads(Path(a.snapshot).read_text()),read(a.main),read(a.terry),json.loads(Path(a.link).read_text()))
 def num(v):
  if isinstance(v,D):return float(v)
  if isinstance(v,collections.Counter):return dict(v)
  raise TypeError(type(v))
 Path(a.output).write_text(json.dumps(out,indent=2,default=num)+'\n');Path(a.audit).write_text(json.dumps(audit,indent=2,default=num)+'\n')
 print(json.dumps({'source_TERRY':audit['terry_unique_orders'],'MAIN_added':audit['missing_MAIN_orders'],'TERRY_included':len(audit['included']),'excluded':audit['excluded'],'review':audit['review']},default=num))
