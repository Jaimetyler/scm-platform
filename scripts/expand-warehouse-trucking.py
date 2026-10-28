"""Expand the pinned Warehouse Intelligence snapshot without recomputing MAIN.
Raw exports stay outside the repository. All joins use text identifiers.
"""
import argparse, collections, copy, csv, hashlib, json
from decimal import Decimal
from pathlib import Path

LOCATIONS = {'SUPPRIGA': 'Savannah', 'SUPPRIG1': 'Savannah', 'SUPPRIG3': 'Savannah', 'SCMBSAGA': 'Savannah',
             'SUPPPAT1': 'Houston', 'SCMDDETX': 'Dallas', 'SCMDDATX': 'Dallas'}
SEGMENTS = {'CNTR': 'cntr', 'DAVIS': 'davis', 'DDRAY': 'ddray', 'TERRY': 'terry'}

def rows(path, encoding='utf-8-sig'):
    with open(path, encoding=encoding, newline='') as f:
        return list(csv.DictReader(f))

def expand(baseline, orders, bridges):
    output = copy.deepcopy(baseline)
    index = {(c['warehouse'], c['code']): c for c in output}
    if len(index) != len(output): raise ValueError('Duplicate baseline customer/location')
    bridge = collections.defaultdict(dict)
    for b in bridges:
        if b['trucking_customer_code'] and b['warehouse_customer_code']:
            bridge[b['trucking_customer_code']][b['warehouse_customer_code']] = b
    audit = {'included': [], 'excluded': collections.Counter(), 'review': []}
    seen = set()
    for order in orders:
        key = (order['company_id'], order['order_id'])
        if key in seen: raise ValueError('Duplicate source order: ' + str(key))
        seen.add(key)
        if order['company_id'] != 'TMS' or not '2025-01-01' <= order['bill_date'] < '2026-10-21':
            raise ValueError('Source company/date outside report scope')
        if order.get('order_type_id') == 'ECOTTON':
            audit['excluded']['ECOTTON'] += 1; continue
        code = order['revenue_code_id']
        if code == 'MAIN': continue  # Existing MAIN snapshot is authoritative.
        if code not in SEGMENTS: raise ValueError('Unexpected revenue code')
        if order['order_status'] == 'V': audit['excluded']['void'] += 1; continue
        connections = {LOCATIONS[x] for x in [order['pickup_location_id'], order['delivery_location_id']] if x in LOCATIONS}
        if not connections: audit['excluded']['no_known_warehouse'] += 1; continue
        matches = list(bridge[order['customer_code']].values())
        if not matches: audit['excluded']['no_customer_bridge'] += 1; continue
        revenue = Decimal(order['total_invoice_revenue'])
        if revenue <= 0:
            audit['excluded'][code + '_nonpositive_revenue'] += 1; continue
        if len(connections) != 1:
            audit['review'].append({'order': order['order_id'], 'reason': 'Ambiguous warehouse location'}); continue
        allocation_note = None
        if len(matches) > 1:
            accounts = sorted(x['warehouse_customer_code'] for x in matches)
            allocation_note = 'Shared trucking bridge: ' + ', '.join(accounts) + '. Counted once; customer allocation not assigned.'
            matches = [{'warehouse_customer_code': 'SHARED:' + order['customer_code'],
                        'warehouse_customer_name': 'Shared trucking — ' + order['customer_code'],
                        'trucking_customer_code': order['customer_code']}]
            audit['review'].append({'order': order['order_id'], 'reason': allocation_note})
        if not order['current_movement_override_pay_amt'] or not order['matched_current_movement_id'] or order['curr_movement_id'] != order['matched_current_movement_id']:
            audit['review'].append({'order': order['order_id'], 'reason': 'Carrier pay/current movement unavailable'}); continue
        pay = Decimal(order['current_movement_override_pay_amt'])
        if pay < 0:
            audit['review'].append({'order': order['order_id'], 'reason': 'Negative pay requires review'}); continue
        location, b = next(iter(connections)), matches[0]
        key = (location, b['warehouse_customer_code'])
        if key not in index:
            names = {x['name'] for x in baseline if x['code'] == key[1]}
            if len(names) > 1: raise ValueError('Conflicting existing customer names')
            name = next(iter(names)) if names else b['warehouse_customer_name'].removesuffix(' - 3PL').removesuffix(' -3PL').strip()
            c = {'warehouse': location, 'code': key[1], 'name': name,
                 'otrCode': b['trucking_customer_code'], 'warehouseDataAvailable': False,
                 'metrics': {}, 'months': []}
            output.append(c); index[key] = c
        if allocation_note: c['allocationNote'] = allocation_note
        c = index[key]
        prefix = SEGMENTS[code]
        month = order['bill_date'][:7]
        m = next((x for x in c['months'] if x['month'] == month), None)
        if m is None: m = {'month': month}; c['months'].append(m)
        for target in [c['metrics'], m]:
            for suffix, amount in [('Loads', Decimal(1)), ('Revenue', revenue), ('Pay', pay)]:
                metric = prefix + suffix
                target[metric] = Decimal(str(target.get(metric, 0))) + amount
        audit['included'].append({'order': order['order_id'], 'code': code, 'warehouse': location,
                                  'customer': c['code'], 'revenue': str(revenue), 'pay': str(pay)})
    for c in output:
        c['months'].sort(key=lambda m: m['month'])
        for metric in ['Loads', 'Revenue', 'Pay']:
            for target in [c['metrics'], *c['months']]:
                target['trucking' + metric] = sum((Decimal(str(target.get(prefix + metric, 0))) for prefix in ['otr', 'terry', 'cntr', 'davis', 'ddray']), Decimal(0))
    return output, audit

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    for key in ['baseline', 'orders', 'bridges', 'output', 'audit']: p.add_argument('--' + key, required=True)
    p.add_argument('--bridge-encoding', default='cp1252')
    a = p.parse_args()
    result, audit = expand(json.loads(Path(a.baseline).read_text()), rows(a.orders), rows(a.bridges, a.bridge_encoding))
    def number(v):
        if isinstance(v, Decimal): return int(v) if v == v.to_integral_value() else float(v)
        raise TypeError(type(v))
    Path(a.output).write_text(json.dumps(result, indent=2, default=number) + '\n')
    audit['excluded'] = dict(audit['excluded'])
    audit['source_sha256'] = {k: hashlib.sha256(Path(getattr(a, k)).read_bytes()).hexdigest() for k in ['baseline','orders','bridges']}
    Path(a.audit).write_text(json.dumps(audit, indent=2) + '\n')
    counts = collections.Counter((x['code'], x['warehouse']) for x in audit['included'])
    print(json.dumps({'included': {str(k): v for k,v in counts.items()}, 'excluded': audit['excluded'], 'review': audit['review']}))
