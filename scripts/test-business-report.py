import collections,importlib.util,unittest
from pathlib import Path
from decimal import Decimal as D
s=importlib.util.spec_from_file_location('business',Path(__file__).with_name('build-business-report.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Business(unittest.TestCase):
 def report(self):return m.Report(m.Families([{'code':'C','name':'Synthetic customer','bridge':None}],[]))
 def order(self,**kw):return {**dict(company='TMS',id='O',customer='C',code='DAVIS',type='FSC',status='D',bill='2025-01-02',revenue='100',movement='M',matched='M',pay='60',pickup='SUPPRIGA',delivery='REMOTE'),**kw}
 def audit(self):return collections.defaultdict(D)
 def test_unit_uses_endpoints_before_revenue_code_and_preserves_interwarehouse(self):
  self.assertEqual(m.assign_unit('SUPPRIGA','REMOTE','DAVIS'),'Savannah')
  self.assertEqual(m.assign_unit('REMOTE','SUPPPAT1','MAIN'),'Houston')
  self.assertEqual(m.assign_unit('SUPPPOG4','REMOTE','CNTR'),'Savannah')
  self.assertEqual(m.assign_unit('SUPPBATX','REMOTE','DDRAY'),'Houston')
  self.assertEqual(m.assign_unit('SUPPGAG3','REMOTE','MAIN'),'Savannah')
  self.assertEqual(m.assign_unit('SUPPPOG4','SUPPBAT1','HLOCA'),'Allocation review')
  self.assertEqual(m.assign_unit('SUPPRIGA','SCMDDETX','MAIN'),'Allocation review')
  self.assertEqual(m.assign_unit('REMOTE','PORT','DDRAY'),'Brokerage')
  self.assertEqual(m.assign_unit('REMOTE','PORT','HLOCA'),'Houston')
 def test_explicit_bridges_merge_but_same_names_do_not(self):
  f=m.Families([{'code':'C','name':'Same','bridge':None},{'code':'W','name':'Warehouse','bridge':'C'},{'code':'OTHER','name':'Same','bridge':None}],[])
  self.assertEqual(f.resolve('W')[0],f.resolve('C')[0]);self.assertNotEqual(f.resolve('OTHER')[0],f.resolve('C')[0])
 def test_sources_deduplicated_by_order_identity_conflicts_rejected(self):
  r=self.report();a=self.audit();o=self.order();m.transport(r,[o,dict(o)],{('TMS','O')},a)
  self.assertEqual(a['transport_orders'],1);self.assertEqual(r.finish()[0]['metrics']['otrRevenue'],D(100))
  with self.assertRaises(ValueError):m.transport(self.report(),[o,{**o,'revenue':'101'}],set(),self.audit())
 def test_confirmed_non_cotton_customer_stays_in_combined_report(self):
  r=self.report();o=self.order(customer='KLEN74GA');m.transport(r,[o],{('TMS','O')},self.audit());out=r.finish()
  self.assertEqual(out[0]['scope'],'Non-Cotton');self.assertEqual(out[0]['metrics']['otrRevenue'],D(100))
 def test_zero_and_missing_pay_are_distinct(self):
  r=self.report();m.transport(r,[self.order(pay='0',revenue='0'),self.order(id='MISSING',matched='',pay='')],set(),self.audit());metric=r.finish()[0]['metrics']
  self.assertEqual(metric['otrPay'],0);self.assertEqual(metric['otrRevenueWithPay'],0);self.assertEqual(metric['otrPayMissing'],1);self.assertEqual(metric['otrOrders'],2)
 def test_cotton_warehouse_does_not_reimport_trucking(self):
  r=self.report();c=dict(warehouse='Savannah',code='C',accounts=['C'],codes=['LOCAL'],relationshipReview=False,metrics={'warehouseOrders':1,'warehouseRevenue':100},months=[dict(month='2025-01',warehouseOrders=1,warehouseDetailedOrders=1,warehouseRevenue=100,warehouseHandling=60,warehouseStorage=40,otrRevenue=999)])
  m.warehouse(r,[c],[],[],self.audit());metric=r.finish()[0]['metrics'];self.assertEqual(metric['warehouseRevenue'],100);self.assertNotIn('otrRevenue',metric)
 def test_warehouse_invoice_trucking_component_counted_once_with_unknown_cost(self):
  r=self.report();c=dict(warehouse='Savannah',code='C',months=[dict(month='2025-01',handling=80,other=20,drayage=50)])
  h=dict(order_id='I',warehouse='LOCAL',customer_code='C',bill_date='2025-01-02',total_order_revenue='150',drayage_revenue='50')
  m.warehouse(r,[],[c],[h],self.audit());metric=r.finish()[0]['metrics'];self.assertEqual(metric['warehouseRevenue']+metric['drayRevenue'],150);self.assertEqual(metric['drayPayMissing'],1);self.assertNotIn('drayRevenueWithPay',metric)
 def test_contract_credits_and_reused_invoice_numbers_on_different_dates(self):
  r=self.report();base={'Customer':'C','Invoice number':'S','Bill type':'Invoice','Bill date':'01/02/25','Reference number':'Contract Storage Savannah','Total':'100'}
  m.contracts(r,[base,{**base,'Bill date':'02/02/25'},{**base,'Invoice number':'CR','Bill type':'Credit memo','Total':'20'}],self.audit());out=r.finish()[0]
  self.assertEqual(out['scope'],'Unclassified');self.assertEqual(out['metrics']['warehouseStorage'],180);self.assertEqual(out['metrics']['contractDocuments'],3)
 def test_cntr_and_ddray_are_direct_local_codes_are_local(self):
  for code in ['CNTR','DDRAY','LOCAL','HLOCA']:
   r=self.report();m.transport(r,[self.order(code=code)],set(),self.audit());metric=r.finish()[0]['metrics']
   prefix='directDray' if code in ['CNTR','DDRAY'] else 'localDray'
   self.assertEqual(metric[prefix+'Orders'],1);self.assertEqual(metric[prefix+'Revenue'],100);self.assertEqual(metric[prefix+'Pay'],60)
   self.assertEqual(metric['drayRevenue'],metric[prefix+'Revenue'])
 def test_local_monthly_costs_zero_revenue_dedup_and_endpoint_assignment(self):
  r=self.report();a=self.audit();row=dict(company_id='TMS',customer_code='C',revenue_code_id='HLOCA',bill_month='2025-04',pickup_location_id='REMOTE',delivery_location_id='SUPPRIGA',trucking_loads=2,trucking_revenue=0,verified_carrier_pay=700,revenue_with_verified_pay=0,missing_carrier_pay_loads=0,zero_revenue_loads=2,missing_revenue_loads=0)
  m.local_monthly(r,[row],a);c=r.finish()[0];self.assertEqual(c['warehouse'],'Savannah');self.assertEqual(c['metrics']['localDrayPay'],700);self.assertEqual(c['metrics']['localDrayRevenue'],0);self.assertEqual(c['metrics']['uniqueTransportOrders'],2)
  with self.assertRaises(ValueError):m.local_monthly(self.report(),[row,row],self.audit())
  for change in [{'missing_revenue_loads':1},{'missing_carrier_pay_loads':3},{'revenue_with_verified_pay':1},{'trucking_loads':-1}]:
   with self.assertRaises(ValueError):m.local_monthly(self.report(),[{**row,**change}],self.audit())
 def test_report_end_date_is_enforced(self):
  self.assertTrue(m.inperiod('2026-10-20'));self.assertFalse(m.inperiod('2026-10-21'));self.assertFalse(m.inperiod('2024-12-31'))
if __name__=='__main__':unittest.main()
