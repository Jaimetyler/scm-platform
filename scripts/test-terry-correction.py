import importlib.util,unittest
s=importlib.util.spec_from_file_location('correction','scripts/import-terry-correction.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Correction(unittest.TestCase):
 def setUp(self):
  self.link={'warehouse':'Savannah','warehouse_customer_code':'3PLSYN','trucking_customer_code':'SYN','name':'Synthetic'}
 def order(self,**kw):
  return {'company_id':'TMS','order_id':'1','customer_code':'SYN','revenue_code_id':'MAIN','order_type_id':'','order_status':'D','bill_date':'2025-02-01','total_invoice_revenue':'100','current_movement_override_pay_amt':'60','curr_movement_id':'M','matched_current_movement_id':'M','pickup_location_id':'SUPPRIGA','delivery_location_id':'OTHER',**kw}
 def terry(self,**kw):
  return self.order(order_id='T1',revenue_code_id='TERRY',customer_code='PERF',warehouse_customer_code='3PLPERF',warehouse_customer_name='Synthetic Perf - 3PL',warehouse_trucking_bridge='PERF',**kw)
 def test_missing_main_and_terry_roll_up_without_changing_existing_metrics(self):
  base=[{'warehouse':'Savannah','code':'3PLPERF','name':'Synthetic Perf','otrCode':'PERF','metrics':{'storage':75},'months':[{'month':'2025-02','storage':75}]}]
  out,a=m.correct(base,[self.order()],[self.terry()],self.link)
  perf=next(c for c in out if c['code']=='3PLPERF');wise=next(c for c in out if c['code']=='3PLSYN')
  self.assertEqual(perf['metrics']['storage'],75);self.assertEqual(perf['metrics']['terryRevenue'],100);self.assertEqual(perf['metrics']['truckingRevenue'],100)
  self.assertEqual(wise['metrics']['otrLoads'],1);self.assertFalse(wise['warehouseDataAvailable'])
 def test_unrelated_main_and_ecotton_excluded(self):
  out,a=m.correct([],[self.order(pickup_location_id='OTHER'),self.order(order_id='2',order_type_id='ECOTTON')],[self.terry(order_type_id='ECOTTON')],self.link)
  self.assertEqual(a['missing_MAIN_orders'],0);self.assertFalse(a['included'])
 def test_repeated_bridge_rows_count_terry_once(self):
  x=self.terry();out,a=m.correct([],[self.order()],[x,dict(x)],self.link);self.assertEqual(len(a['included']),1)
 def test_conflicts_and_repeat_import_rejected(self):
  with self.assertRaises(ValueError):m.correct([],[self.order()],[self.terry(),self.terry(total_invoice_revenue='200')],self.link)
  out,a=m.correct([],[self.order()],[],self.link)
  with self.assertRaises(ValueError):m.correct(out,[self.order()],[],self.link)
if __name__=='__main__':unittest.main()
