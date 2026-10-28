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

def invoice_charge_details(rows):
 result={}
 for x in rows:
  if x['order_type_id']!='ECOTTON':continue
  key=(x['company_id'],x['order_id'])
  if key in result:raise ValueError('Repeated invoice summary')
  total,freight,charges,lines=[amount(x[k]) for k in ['total_order_revenue','freight_charge','other_charge_total','charge_line_total']]
  parts=[amount(x[k]) for k in ['warehouse_handling','warehouse_storage','warehouse_other']]
  if None in [total,freight,charges,lines,*parts] or D(x['null_charge_amounts'])!=0:raise ValueError('Missing invoice summary amounts')
  if lines!=charges or freight+charges!=total or sum(parts)!=total:raise ValueError('Invoice summary does not reconcile')
  result[key]={'customer':x['customer_code'],'date':x['bill_date'],'total':total,'metrics':dict(zip(['warehouseHandling','warehouseStorage','warehouseOther'],parts))}
 return result

def charge_details(path):
 if not path:return {}
 if isinstance(path,list):
  result={}
  for item in path:
   part=charge_details(item)
   if result.keys() & part.keys():raise ValueError('Invoice repeated across charge exports')
   result.update(part)
  return result
 with open(path,encoding='utf-8-sig',newline='') as f:rows=list(csv.DictReader(f))
 if rows and 'warehouse_handling' in rows[0]:return invoice_charge_details(rows)
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
   if 'stor' in desc or 'stg' in desc or code in ['DCS','DC36','CTS','HCS','SC34','SC44','H106']:bucket='warehouseStorage'
   elif any(w in desc for w in ['recei','ship','handling','loading']) or code in ['DCRS','DCH','DC23','DC64','DC65']:bucket='warehouseHandling'
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

def apply_monthly_details(customers,partitions,path):
 """Match each compact export group to independent source invoice counts/totals."""
 orders={}
 for partition in partitions:
  for o in partition['orders']:orders[(o['company'],o['id'])]=o
 expected={}
 for o in orders.values():
  if category(o)!='warehouse':continue
  k=(o['company'],o['customer'],o['code'],str(o['bill'])[:6])
  g=expected.setdefault(k,{'count':0,'total':D(0)});g['count']+=1;g['total']+=amount(o['revenue'])
 with open(path,encoding='utf-8-sig',newline='') as f:rows=list(csv.DictReader(f))
 received={}
 for x in rows:
  if x['customer_code'] in NON_COTTON_CUSTOMERS:continue
  k=(x['company_id'],x['customer_code'],x['revenue_code_id'],x['bill_month'].replace('-',''))
  if k in received:raise ValueError('Duplicate monthly charge group')
  if k not in expected:raise ValueError('Unexpected monthly charge group')
  count=D(x['warehouse_invoices']);total=amount(x['warehouse_revenue'])
  parts=[amount(x[n]) for n in ['warehouse_handling','warehouse_storage','warehouse_other']]
  if count!=expected[k]['count'] or total!=expected[k]['total']:raise ValueError('Monthly source counts/revenue changed')
  if D(x['invoice_reconciliation_issues'])!=0 or None in parts or sum(parts)!=total:raise ValueError('Monthly charge components do not reconcile')
  received[k]={'warehouseDetailedOrders':count,**dict(zip(['warehouseHandling','warehouseStorage','warehouseOther'],parts))}
 if received.keys()!=expected.keys():raise ValueError('Missing monthly charge groups')
 fields=['warehouseDetailedOrders','warehouseHandling','warehouseStorage','warehouseOther'];targets={}
 for c in customers:
  for account in c['accounts']:targets[(c['warehouse'],account)]=c
  for metrics in [c['metrics'],*c['months']]:
   for field in fields:metrics.pop(field,None)
 for (_,account,code,period),values in received.items():
  c=targets[(LOCAL_CODES[code],account)];month=period[:4]+'-'+period[4:]
  monthly=next(m for m in c['months'] if m['month']==month)
  for target in [c['metrics'],monthly]:
   for field,value in values.items():target[field]=target.get(field,D(0))+value
 return {'monthly_charge_groups':len(received),'warehouse_invoices':sum(v['warehouseDetailedOrders'] for v in received.values())}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source-dir',required=True);p.add_argument('--charge-csv',action='append');p.add_argument('--monthly-charge-csv');p.add_argument('--customer-metadata');p.add_argument('--output',required=True);p.add_argument('--audit',required=True);a=p.parse_args()
 manifest=json.loads((Path(a.source_dir)/'manifest.json').read_text())
 if not manifest.get('complete'):raise ValueError('Cotton extraction not complete')
 partitions=[json.loads((Path(a.source_dir)/(x['key']+'.json')).read_text()) for x in manifest['sources']]
 required={x+'-cotton' for x in ['MAIN','DAVIS','DDRAY','LOCAL','HLOCAL','HLOCA']}|{x+'-ecotton' for x in ['LOCAL','HLOCAL','HLOCA','DLOCA']}
 if {x['key'] for x in manifest['sources']}!=required:raise ValueError('Missing cotton source partition')
 extra=json.loads(Path(a.customer_metadata).read_text()) if a.customer_metadata else []
 result,audit=build(partitions,charge_details(a.charge_csv),extra)
 if a.monthly_charge_csv:audit['monthly_detail']=apply_monthly_details(result,partitions,a.monthly_charge_csv)
 def number(x):
  if isinstance(x,D):return float(x)
  raise TypeError(type(x))
 raw=json.dumps(result,indent=2,default=number)+'\n';Path(a.output).write_text(raw)
 audit['included']=dict(audit['included']);audit['excluded']=dict(audit['excluded']);audit['snapshot_sha256']=hashlib.sha256(raw.encode()).hexdigest()
 Path(a.audit).write_text(json.dumps(audit,indent=2,default=number)+'\n');print(json.dumps({'customers_locations':len(result),'included':audit['included'],'review_count':len(audit['review'])}))
