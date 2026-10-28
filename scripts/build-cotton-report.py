"""Build a private, reconciled cotton finance snapshot from read-only source partitions."""
import argparse, collections, csv, hashlib, json
from decimal import Decimal as D
from pathlib import Path
# Confirmed non-cotton accounts: source commodity coding is incorrect.
NON_COTTON_CUSTOMERS={'KLEN74GA','CKTRCHIL','RSMCCHNC','EVANONCA','HAMPPOOR','HOBBOKOK'}
LOCAL_CODES={'LOCAL':'Savannah','HLOCAL':'Houston','HLOCA':'Houston','DLOCA':'Dallas'}
LOCATIONS={'SUPPRIGA':'Savannah','SUPPRIG1':'Savannah','SUPPRIG2':'Savannah','SUPPRIG3':'Savannah','SCMBSAGA':'Savannah','SUPPPOG5':'Savannah','SAVWHSE':'Savannah','SCMRIG2':'Savannah','SAVAGAG2':'Savannah','SUPPSAG2':'Savannah',
 'SUPPPAT1':'Houston','SUPPBAT1':'Houston','HOUWHSE':'Houston','SCMDDETX':'Dallas','SCMDDATX':'Dallas'}

def amount(value):
 if value is None or str(value).strip()=='':return None
 n=D(str(value))
 if not n.is_finite():raise ValueError('Non-finite financial value')
 return n.quantize(D('.01'))

def category(order):
 if order.get('customer') in NON_COTTON_CUSTOMERS:return None
 code=order['code'];typ=order['type'].upper();commodity=order['commodity'].upper()
 if order['status'].upper()=='V':return None
 if typ=='ECOTTON' and code in LOCAL_CODES:return 'warehouse'
 if commodity!='COTTON':return None
 if code in ['MAIN','DAVIS']:return 'otr'
 if typ!='ECOTTON' and code in ['LOCAL','HLOCAL','HLOCA','DDRAY']:return 'dray'
 return None

def terminal(order,kind):
 if kind=='warehouse' or order['code'] in ['LOCAL','HLOCAL','HLOCA']:return LOCAL_CODES[order['code']]
 if order['code'] in ['DAVIS','DDRAY']:return 'Dallas'
 locations={LOCATIONS[x] for x in [order.get('pickup'),order.get('delivery')] if x in LOCATIONS}
 return next(iter(locations)) if len(locations)==1 else 'Unassigned'

def charge_details(path):
 if not path:return {}
 with open(path,encoding='utf-8-sig',newline='') as f:rows=list(csv.DictReader(f))
 groups=collections.defaultdict(list);seen=set()
 for x in rows:
  if x['order_type_id']!='ECOTTON':continue
  key=(x['company_id'],x['order_id'])
  if x['charge_row_id']:
   cid=(x['company_id'],x['charge_row_id'])
   if cid in seen:raise ValueError('Duplicate source charge')
   seen.add(cid)
  groups[key].append(x)
 result={}
 for key,rows in groups.items():
  first=rows[0];metrics=collections.defaultdict(D);s=D(0)
  fixed=['customer_code','bill_date','total_order_revenue','freight_charge','other_charge_total']
  if any(any(x[k]!=first[k] for k in fixed) for x in rows):raise ValueError('Conflicting warehouse detail headers')
  for x in rows:
   if not x['charge_row_id']:continue
   v=amount(x['charge_amount']);code=x['charge_code'];desc=x['charge_description'].lower();s+=v
   if 'stor' in desc or code in ['DCS','DC36','CTS']:bucket='warehouseStorage'
   elif any(w in desc for w in ['receiv','receipt','shipping','handling','loading']) or code in ['DCRS','DCH','DC23']:bucket='warehouseHandling'
   else:bucket='warehouseOther'
   metrics[bucket]+=v
  if s!=amount(first['other_charge_total']) or s+amount(first['freight_charge'])!=amount(first['total_order_revenue']):raise ValueError('Warehouse charge detail does not reconcile')
  metrics['warehouseOther']+=amount(first['freight_charge'])
  result[key]={'customer':first['customer_code'],'date':first['bill_date'],'total':amount(first['total_order_revenue']),'metrics':dict(metrics)}
 return result

def build(partitions,details=None,extra_accounts=None):
 details=details or {};orders={};accounts={};source_counts={}
 for partition in partitions:
  if not partition.get('complete'):raise ValueError('Incomplete source partition')
  if partition.get('start')!='20250101' or partition.get('end')!='20261020':raise ValueError('Inconsistent source period')
  source_counts[partition['source']['key']]=len(partition['orders'])
  for o in partition['orders']:
   if o['company']!='TMS' or not '20250101'<=str(o['bill'])[:8]<='20261020':raise ValueError('Source scope mismatch')
   key=(o['company'],o['id'])
   if key in orders and orders[key]!=o:raise ValueError('Conflicting repeated order snapshot '+o['id'])
   orders[key]=o
   info={'name':o['name'],'bridge':o.get('bridge') or None}
   if o['customer'] in accounts and accounts[o['customer']]!=info:raise ValueError('Customer metadata changed during extraction')
   accounts[o['customer']]=info
 for extra in extra_accounts or []:
  if extra['code'] in accounts:raise ValueError('Extra metadata duplicates source account')
  accounts[extra['code']]={'name':extra['name'],'bridge':extra.get('bridge') or None}
 def family(code):
  visited=set();current=code
  while current in accounts and accounts[current]['bridge']:
   if current in visited:return code,True
   visited.add(current);target=accounts[current]['bridge']
   if target==current:return current,False
   if target not in accounts:return code,True
   current=target
  return current,False
 grouped={};audit={'source_counts':source_counts,'unique_source_orders':len(orders),'included':collections.Counter(),'excluded':collections.Counter(),'review':[]}
 for key,o in orders.items():
  kind=category(o)
  if kind is None:
   reason='confirmed_non_cotton_account' if o['customer'] in NON_COTTON_CUSTOMERS else 'not_in_rules_or_void'
   audit['excluded'][reason]+=1;continue
  revenue=amount(o['revenue'])
  if revenue is None:raise ValueError('Missing order invoice revenue')
  code,bridge_review=family(o['customer']);location=terminal(o,kind);gkey=(location,code)
  if gkey not in grouped:grouped[gkey]={'warehouse':location,'code':code,'name':accounts[code]['name'],'accounts':set(),'codes':set(),'relationshipReview':False,'metrics':collections.defaultdict(D),'months':{}}
  c=grouped[gkey];c['accounts'].add(o['customer']);c['codes'].add(o['code']);c['relationshipReview']|=bridge_review
  date=str(o['bill']);month=date[:4]+'-'+date[4:6]
  m=c['months'].setdefault(month,collections.defaultdict(D))
  values={kind+'Orders':D(1),kind+'Revenue':revenue}
  if kind=='warehouse':
   freight,charges=amount(o.get('freight')),amount(o.get('chargeTotal'))
   if freight is None or charges is None or freight+charges!=revenue:values['warehouseHeaderIssues']=D(1)
   detail=details.get(key)
   if detail and detail['customer']==o['customer'] and detail['date'].replace('-','')==date[:8] and detail['total']==revenue:
    values.update(detail['metrics']);values['warehouseDetailedOrders']=D(1)
   if o['commodity'].upper()!='COTTON':values['warehouseCommodityMissing']=D(1)
  else:
   pay=amount(o.get('pay'));matched=o.get('movementId') is not None and str(o.get('movementId'))==str(o.get('matchedMovementId'))
   if pay is None or not matched:
    values[kind+'PayMissing']=D(1);audit['review'].append({'order':o['id'],'reason':'Current-movement carrier pay unavailable'})
   else:values[kind+'Pay']=pay;values[kind+'RevenueWithPay']=revenue
   if revenue==0:values[kind+'ZeroRevenueOrders']=D(1)
  for target in [c['metrics'],m]:
   for k,v in values.items():target[k]+=v
  audit['included'][kind]+=1
 for c in grouped.values():
  c['accounts']=sorted(c['accounts']);c['codes']=sorted(c['codes']);c['metrics']=dict(c['metrics'])
  c['months']=[{'month':month,**values} for month,values in sorted(c['months'].items())]
 return sorted(grouped.values(),key=lambda x:(x['name'].lower(),x['warehouse'])),audit

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source-dir',required=True);p.add_argument('--charge-csv');p.add_argument('--customer-metadata');p.add_argument('--output',required=True);p.add_argument('--audit',required=True);a=p.parse_args()
 manifest=json.loads((Path(a.source_dir)/'manifest.json').read_text())
 if not manifest.get('complete'):raise ValueError('Cotton extraction not complete')
 partitions=[json.loads((Path(a.source_dir)/(x['key']+'.json')).read_text()) for x in manifest['sources']]
 required={x+'-cotton' for x in ['MAIN','DAVIS','DDRAY','LOCAL','HLOCAL','HLOCA']}|{x+'-ecotton' for x in ['LOCAL','HLOCAL','HLOCA','DLOCA']}
 if {x['key'] for x in manifest['sources']}!=required:raise ValueError('Missing cotton source partition')
 extra=json.loads(Path(a.customer_metadata).read_text()) if a.customer_metadata else []
 result,audit=build(partitions,charge_details(a.charge_csv),extra)
 def number(x):
  if isinstance(x,D):return float(x)
  raise TypeError(type(x))
 raw=json.dumps(result,indent=2,default=number)+'\n';Path(a.output).write_text(raw)
 audit['included']=dict(audit['included']);audit['excluded']=dict(audit['excluded']);audit['snapshot_sha256']=hashlib.sha256(raw.encode()).hexdigest()
 Path(a.audit).write_text(json.dumps(audit,indent=2)+'\n');print(json.dumps({'customers_locations':len(result),'included':audit['included'],'review_count':len(audit['review'])}))
