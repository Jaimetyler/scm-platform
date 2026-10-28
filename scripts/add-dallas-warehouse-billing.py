"""Merge reconciled Dallas 3PL billing and matching contract storage into a private snapshot."""
import argparse, collections, copy, csv, json
from datetime import datetime
from decimal import Decimal as D
from pathlib import Path

def merge(snapshot, source, customer_links, contracts):
    result=copy.deepcopy(snapshot)
    links={x['warehouse_customer_code']:x for x in customer_links}
    index={(x['warehouse'],x['code']):x for x in result}
    audit={'orders':0,'contract_rows':0,'contract_net':'0','excluded_order_types':collections.Counter()}
    def customer(code):
        key=('Dallas',code)
        if key not in index:
            if code not in links: raise ValueError('Missing verified customer name: '+code)
            link=links[code];names={x['name'] for x in result if x['code']==code}
            c={'warehouse':'Dallas','code':code,'name':next(iter(names)) if len(names)==1 else link['warehouse_customer_name'].removesuffix(' - 3PL').strip(),
               'otrCode':link['trucking_customer_code'],'warehouseDataAvailable':True,'metrics':{},'months':[]}
            index[key]=c;result.append(c)
        return index[key]
    def add(c,month,values):
        m=next((x for x in c['months'] if x['month']==month),None)
        if m is None:m={'month':month};c['months'].append(m)
        for obj in [c['metrics'],m]:
            for k,v in values.items():obj[k]=D(str(obj.get(k,0)))+v
    orders=collections.defaultdict(list)
    charge_keys=set()
    for row in source:
        if row['company_id']!='TMS' or row['revenue_code_id']!='DLOCA' or not '2025-01-01'<=row['bill_date']<'2026-10-21':raise ValueError('Invalid Dallas source scope')
        if row['order_type_id']!='3PL':audit['excluded_order_types'][row['order_type_id']]+=1;continue
        if row['order_status']=='V':continue
        orders[row['order_id']].append(row)
    for oid,rows in orders.items():
        first=rows[0]
        fixed=['customer_code','bill_date','total_order_revenue','order_base_rate','freight_charge','other_charge_total']
        if any(any(x[k]!=first[k] for k in fixed) for x in rows):raise ValueError('Conflicting repeated order header '+oid)
        c=customer(first['customer_code']);values=collections.defaultdict(D)
        total=D(first['total_order_revenue']);freight=D(first['freight_charge']);base=D(first['order_base_rate'])
        if freight!=base:raise ValueError('Non-flat base amount needs review '+oid)
        charges=D(0)
        for row in rows:
            if not row['charge_row_id']:
                if row['charge_code'] or row['charge_amount']:raise ValueError('Charge without identity')
                continue
            key=(row['company_id'],row['charge_row_id'])
            if key in charge_keys:raise ValueError('Duplicate charge '+str(key))
            charge_keys.add(key);amount=D(row['charge_amount']);charges+=amount
            category={'D3OH':'handling','D3OS':'storage','C3':'other'}.get(row['charge_code'])
            if category is None:raise ValueError('Unclassified Dallas charge '+row['charge_code'])
            values[category]+=amount
        if charges!=D(first['other_charge_total']) or charges+freight!=total:raise ValueError('Invoice components do not reconcile '+oid)
        values.update(orders=D(1),drayage=base,accessorials=charges,warehouseInvoiceRevenue=total)
        add(c,first['bill_date'][:7],values);audit['orders']+=1
    by_truck=collections.defaultdict(set)
    for code,link in links.items():by_truck[link['trucking_customer_code']].add(code)
    contract_keys=set();net=D(0)
    for row in contracts:
        ref=row['Reference number'].lower()
        if not ('dallas' in ref or ' dal' in ref):continue
        date=datetime.strptime(row['Bill date'],'%m/%d/%y').date().isoformat()
        if not '2025-01-01'<=date<'2026-10-21':continue
        codes={row['Customer']} if row['Customer'] in links else by_truck.get(row['Customer'],set())
        if not codes:continue
        if len(codes)!=1:raise ValueError('Ambiguous contract customer '+row['Customer'])
        key=tuple(row.items())
        if key in contract_keys:raise ValueError('Duplicate contract source record')
        contract_keys.add(key)
        amount=D(row['Total'])
        if row['Bill type']=='Credit memo':amount=-abs(amount)
        elif row['Bill type']!='Invoice':raise ValueError('Unsupported contract bill type')
        add(customer(next(iter(codes))),date[:7],{'contractStorage':amount})
        audit['contract_rows']+=1;net+=amount
    # The full DLOCA export establishes coverage, including genuine no-activity rows.
    for c in result:
        if c['warehouse']=='Dallas':c['warehouseDataAvailable']=True
        c['months'].sort(key=lambda x:x['month'])
        for obj in [c['metrics'],*c['months']]:
            for suffix in ['Loads','Revenue','Pay']:
                obj['trucking'+suffix]=sum((D(str(obj.get(p+suffix,0))) for p in ['otr','cntr','davis','ddray']),D(0))
    audit['contract_net']=str(net);audit['excluded_order_types']=dict(audit['excluded_order_types'])
    return result,audit

if __name__=='__main__':
 p=argparse.ArgumentParser()
 for k in ['snapshot','source','customer-links','contracts','output','audit']:p.add_argument('--'+k,required=True)
 a=p.parse_args()
 def read(path,encoding):
  with open(path,encoding=encoding,newline='') as f:return list(csv.DictReader(f))
 out,audit=merge(json.loads(Path(a.snapshot).read_text()),read(a.source,'utf-8-sig'),json.loads(Path(a.customer_links).read_text()),read(a.contracts,'cp1252'))
 Path(a.output).write_text(json.dumps(out,indent=2,default=lambda v:float(v) if isinstance(v,D) else str(v))+'\n');Path(a.audit).write_text(json.dumps(audit,indent=2)+'\n');print(json.dumps(audit))
