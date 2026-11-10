#!/usr/bin/env python3
"""Apply vetted lumber contract storage to SCM warehouse intelligence snapshot.
Run from repository root: python apply_contract_storage.py --csv scm_lumber_contract_storage_import.csv
Creates backup and audit; never includes cotton or unresolved rows.
"""
import argparse,csv,json,shutil
from collections import defaultdict
from decimal import Decimal
from pathlib import Path
from datetime import datetime

p=argparse.ArgumentParser();p.add_argument('--csv',default='scm_lumber_contract_storage_import.csv');p.add_argument('--report',default='lib/reporting/warehouse-intelligence-data.json');p.add_argument('--start',default='2025-01');p.add_argument('--dry-run',action='store_true');args=p.parse_args()
report_path=Path(args.report); records=json.loads(report_path.read_text(encoding='utf-8'))
rows=list(csv.DictReader(open(args.csv,encoding='utf-8-sig',newline='')))
bridge={}
for i,c in enumerate(records):
 for code in (c.get('otrCode',''),c.get('code','')):
  if code:
   bridge.setdefault((c['warehouse'],code),[]).append(i)
by_customer=defaultdict(lambda:defaultdict(lambda:Decimal('0')))
seen=set();rejected=[];included=[]
for x in rows:
 key=(x['source_row'],x['customer_code'],x['invoice_number'])
 if key in seen:raise ValueError(f'Duplicate input transaction {key}')
 seen.add(key)
 if x['warehouse_segment']!='Lumber / general' or x['import_status']!='READY' or x['review_required']!='NO':
  rejected.append((key,'not approved'));continue
 month=datetime.strptime(x['bill_date'],'%m/%d/%y').strftime('%Y-%m')
 if month<args.start:rejected.append((key,'outside report period'));continue
 loc=x['approved_location']
 candidates=bridge.get((loc,x['customer_code']),[])
 if len(candidates)!=1:raise ValueError(f'Customer bridge ambiguous/missing: {loc} {x["customer_code"]}: {candidates}')
 amt=Decimal(x['signed_amount'])
 if x['bill_type'].lower().startswith('credit') and amt>0:raise ValueError(f'Credit not negative: {key}')
 by_customer[candidates[0]][month]+=amt
 included.append((key,month,str(amt)))
# Idempotent replacement of dedicated metric, not additive to existing storage
for c in records:
 c['metrics'].pop('contractStorage',None)
 for m in c['months']:m.pop('contractStorage',None)
for idx,months in by_customer.items():
 c=records[idx];c['metrics']['contractStorage']=float(sum(months.values(),Decimal('0')))
 existing={m['month']:m for m in c['months']}
 for month,amount in months.items():
  existing.setdefault(month,{'month':month})['contractStorage']=float(amount)
 c['months']=sorted(existing.values(),key=lambda m:m['month'])
audit={'period_start':args.start,'included_count':len(included),'included_total':str(sum((Decimal(v) for _,_,v in included),Decimal('0'))),'excluded_count':len(rejected),'customer_totals':[{ 'warehouse':records[i]['warehouse'],'customer':records[i]['name'],'code':records[i]['otrCode'],'amount':str(sum(m.values(),Decimal('0')))} for i,m in by_customer.items()]}
print(json.dumps(audit,indent=2))
if not args.dry_run:
 backup=report_path.with_suffix('.json.pre-contract-storage.bak')
 if not backup.exists():shutil.copy2(report_path,backup)
 report_path.write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 Path('contract-storage-audit.json').write_text(json.dumps(audit,indent=2)+'\n',encoding='utf-8')
 print('Wrote report, audit, and preserved original backup:',backup)
