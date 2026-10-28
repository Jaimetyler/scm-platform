import importlib.util,unittest
s=importlib.util.spec_from_file_location('dallas','scripts/add-dallas-warehouse-billing.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Dallas(unittest.TestCase):
 def setUp(self):
  self.links=[{'warehouse_customer_code':'3PLTEST','warehouse_customer_name':'Test - 3PL','trucking_customer_code':'TEST'}]
 def row(self,**kw):
  return dict(company_id='TMS',revenue_code_id='DLOCA',order_id='1',customer_code='3PLTEST',order_type_id='3PL',order_status='D',bill_date='2025-01-01',total_order_revenue='150',order_base_rate='0',freight_charge='0',other_charge_total='150',charge_row_id='C1',charge_code='D3OH',charge_amount='100',**kw)
 def test_multiple_charges_count_order_once_and_classify(self):
  a=self.row();b={**a,'charge_row_id':'C2','charge_code':'D3OS','charge_amount':'50'}
  out,audit=m.merge([], [a,b], self.links,[]);self.assertEqual(out[0]['metrics']['orders'],1);self.assertEqual(out[0]['metrics']['handling'],100);self.assertEqual(out[0]['metrics']['storage'],50);self.assertEqual(audit['orders'],1)
 def test_ecotton_not_imported(self):
  a={**self.row(),'order_type_id':'ECOTTON'};out,audit=m.merge([],[a],self.links,[]);self.assertEqual(out,[])
 def test_duplicate_charge_and_bad_total_rejected(self):
  with self.assertRaises(ValueError):m.merge([],[self.row(),self.row()],self.links,[])
  with self.assertRaises(ValueError):m.merge([],[self.row()],self.links,[])
 def test_credit_memo_nets_without_deduplicating_rebill(self):
  c={'Reference number':'Dallas Contract Storage','Bill date':'01/01/25','Customer':'TEST','Invoice number':'INV','Total':'50','Bill type':'Invoice'}
  out,audit=m.merge([],[],self.links,[c,{**c,'Bill type':'Credit memo'}]);self.assertEqual(out[0]['metrics']['contractStorage'],0);self.assertEqual(audit['contract_rows'],2)
if __name__=='__main__':unittest.main()
