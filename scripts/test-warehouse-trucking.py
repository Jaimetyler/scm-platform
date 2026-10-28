import importlib.util, unittest
spec=importlib.util.spec_from_file_location('expand','scripts/expand-warehouse-trucking.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Expansion(unittest.TestCase):
 def setUp(self):
  self.baseline=[{'warehouse':'Savannah','code':'3PLTEST','name':'Test','otrCode':'TEST','metrics':{'otrLoads':1,'otrRevenue':100,'otrPay':60,'storage':50},'months':[{'month':'2025-01','otrLoads':1,'otrRevenue':100,'otrPay':60,'storage':50}]}]
  self.bridges=[{'warehouse_customer_code':'3PLTEST','warehouse_customer_name':'Test - 3PL','trucking_customer_code':'TEST'}]
 def order(self,**kw):
  return {'company_id':'TMS','order_id':'1','customer_code':'TEST','bill_date':'2025-01-02','revenue_code_id':'CNTR','order_status':'D','total_invoice_revenue':'200','current_movement_override_pay_amt':'125','curr_movement_id':'M1','matched_current_movement_id':'M1','pickup_location_id':'PORT','delivery_location_id':'SUPPRIG1',**kw}
 def test_original_metrics_and_aliases(self):
  for alias in ['SUPPRIGA','SUPPRIG1','SUPPRIG3']:
   out,a=m.expand(self.baseline,[self.order(delivery_location_id=alias)],self.bridges)
   for k,v in self.baseline[0]['metrics'].items():self.assertEqual(out[0]['metrics'][k],v)
   self.assertEqual(out[0]['metrics']['truckingRevenue'],300);self.assertEqual(out[0]['metrics']['cntrLoads'],1)
 def test_zero_revenue_no_bridge_and_unrelated_moves_excluded(self):
  for change in [{'total_invoice_revenue':'0','revenue_code_id':'DDRAY'},{'customer_code':'OTHER'},{'delivery_location_id':'OTHER'},{'order_status':'V'}]:
   out,a=m.expand(self.baseline,[self.order(**change)],self.bridges);self.assertEqual(len(a['included']),0);self.assertEqual(out[0]['metrics']['truckingLoads'],1)
 def test_missing_pay_and_cross_location_held_for_review(self):
  for change in [{'current_movement_override_pay_amt':''},{'pickup_location_id':'SCMDDETX'}]:
   out,a=m.expand(self.baseline,[self.order(**change)],self.bridges);self.assertEqual(len(a['review']),1);self.assertFalse(a['included'])
 def test_same_location_both_ends_counts_once(self):
  out,a=m.expand(self.baseline,[self.order(pickup_location_id='SUPPRIG3')],self.bridges);self.assertEqual(len(a['included']),1)
 def test_dallas_coverage_unknown_and_duplicate_rejected(self):
  out,a=m.expand(self.baseline,[self.order(revenue_code_id='DAVIS',delivery_location_id='SCMDDETX')],self.bridges)
  self.assertFalse(out[1]['warehouseDataAvailable']);self.assertNotIn('storage',out[1]['metrics'])
  with self.assertRaises(ValueError):m.expand(self.baseline,[self.order(),self.order()],self.bridges)
 def test_shared_customer_bridge_counts_once_without_guessing(self):
  b=self.bridges+[dict(self.bridges[0],warehouse_customer_code='3PLOTHER',warehouse_customer_name='Other')]
  out,a=m.expand(self.baseline,[self.order()],b)
  self.assertEqual(len(a['included']),1);self.assertEqual(out[1]['code'],'SHARED:TEST');self.assertIn('allocationNote',out[1])
 def test_ecotton_excluded(self):
  out,a=m.expand(self.baseline,[self.order(order_type_id='ECOTTON')],self.bridges);self.assertFalse(a['included'])
 def test_main_is_not_recomputed(self):
  out,a=m.expand(self.baseline,[self.order(revenue_code_id='MAIN',total_invoice_revenue='999')],self.bridges);self.assertEqual(out[0]['metrics']['truckingRevenue'],100)
if __name__=='__main__':unittest.main()
