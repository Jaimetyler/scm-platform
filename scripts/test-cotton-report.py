import importlib.util,unittest
s=importlib.util.spec_from_file_location('cotton','scripts/build-cotton-report.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Cotton(unittest.TestCase):
 def order(self,**kw):
  base=dict(company='TMS',id='O1',customer='CUST',name='Synthetic cotton',bridge=None,code='MAIN',type='FSC',commodity='COTTON',status='D',bill='20250102000000-0500',revenue=100,freight=100,chargeTotal=0,movementId='M',matchedMovementId='M',pay=60,payee='CARRIER',pickup='REMOTE',delivery='SAVWHSE')
  return {**base,**kw}
 def part(self,orders,key='MAIN-cotton'):
  return {'source':{'key':key},'complete':True,'start':'20250101','end':'20261020','orders':orders}
 def test_mutually_exclusive_categories_and_commodity(self):
  o=self.order();self.assertEqual(m.category(o),'otr')
  for code in ['LOCAL','HLOCAL','HLOCA','DLOCA']:
   w={**o,'code':code,'type':'ECOTTON','commodity':''};self.assertEqual(m.category(w),'warehouse')
  self.assertEqual(m.category({**o,'code':'DDRAY'}),'dray')
  self.assertEqual(m.category({**o,'code':'LOCAL'}),'dray')
  self.assertIsNone(m.category({**o,'commodity':'LUMBER'}));self.assertIsNone(m.category({**o,'code':'TERRY'}));self.assertIsNone(m.category({**o,'status':'V'}))
 def test_duplicate_source_order_counted_once_and_conflict_rejected(self):
  o=self.order();out,a=m.build([self.part([o]),self.part([dict(o)],'other')]);self.assertEqual(out[0]['metrics']['otrOrders'],1)
  with self.assertRaises(ValueError):m.build([self.part([o,{**o,'revenue':120}])])
 def test_explicit_customer_bridge_merges_accounts(self):
  o=self.order();w={**o,'id':'W1','customer':'ECUST','name':'Synthetic warehouse','bridge':'CUST','code':'LOCAL','type':'ECOTTON','freight':0,'chargeTotal':100}
  out,a=m.build([self.part([o,w])]);self.assertEqual(len(out),1);self.assertEqual(out[0]['accounts'],['CUST','ECUST']);self.assertEqual(out[0]['metrics']['warehouseRevenue'],100)
 def test_no_guess_for_missing_pay_or_unknown_main_terminal(self):
  o=self.order(pay=None,delivery='UNKNOWN');out,a=m.build([self.part([o])]);self.assertEqual(out[0]['warehouse'],'Unassigned');self.assertEqual(out[0]['metrics']['otrRevenue'],100);self.assertEqual(out[0]['metrics']['otrPayMissing'],1);self.assertNotIn('otrPay',out[0]['metrics'])
 def test_warehouse_detail_requires_receipt_match(self):
  o=self.order(code='DLOCA',type='ECOTTON',freight=0,chargeTotal=100)
  details={('TMS','O1'):{'customer':'CUST','date':'2025-01-02','total':m.D(100),'metrics':{'warehouseStorage':m.D(100)}}}
  out,a=m.build([self.part([o])],details);self.assertEqual(out[0]['metrics']['warehouseDetailedOrders'],1);self.assertEqual(out[0]['metrics']['warehouseStorage'],100)
 def test_invoice_summary_components_reconcile_with_signed_credits(self):
  row=dict(company_id='TMS',order_id='I',customer_code='SYN',order_type_id='ECOTTON',bill_date='2025-01-01',total_order_revenue='100',freight_charge='10',other_charge_total='90',charge_line_total='90',null_charge_amounts='0',warehouse_handling='120',warehouse_storage='-40',warehouse_other='20')
  result=m.invoice_charge_details([row]);self.assertEqual(result[('TMS','I')]['metrics']['warehouseStorage'],m.D('-40'))
  for change in [{'warehouse_storage':'0'},{'charge_line_total':'89'},{'null_charge_amounts':'1'}]:
   with self.assertRaises(ValueError):m.invoice_charge_details([{**row,**change}])
  with self.assertRaises(ValueError):m.invoice_charge_details([row,row])
 def test_unverified_customer_bridge_stays_separate(self):
  out,a=m.build([self.part([self.order(bridge='MISSING')])]);self.assertTrue(out[0]['relationshipReview']);self.assertEqual(out[0]['code'],'CUST')
 def test_confirmed_non_cotton_account_is_excluded(self):
  for customer in m.NON_COTTON_CUSTOMERS:
   for code in ['MAIN','DAVIS','DDRAY','LOCAL']:
    self.assertIsNone(m.category(self.order(customer=customer,code=code)))
  o=self.order(customer=next(iter(m.NON_COTTON_CUSTOMERS)))
  out,a=m.build([self.part([o,self.order(id='VALID')])]);self.assertEqual(len(out),1)
  self.assertEqual(out[0]['metrics']['otrOrders'],1);self.assertEqual(a['excluded']['confirmed_non_cotton_account'],1)
 def test_verified_zero_pay_and_zero_revenue_are_not_missing(self):
  out,a=m.build([self.part([self.order(code='DDRAY',pay=0,revenue=0)])]);self.assertEqual(out[0]['metrics']['drayPay'],0);self.assertEqual(out[0]['metrics']['drayZeroRevenueOrders'],1);self.assertNotIn('drayPayMissing',out[0]['metrics'])
if __name__=='__main__':unittest.main()
