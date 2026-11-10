#!/usr/bin/env python3
"""Update Warehouse Intelligence UI to show contract storage independently."""
from pathlib import Path
p=Path('app/reporting/warehouse-intelligence/warehouse-intelligence.tsx')
s=p.read_text(encoding='utf-8')
changes=[
('  storage?: number;','  storage?: number;\n  contractStorage?: number;'),
("val(d,'storage')+val(d,'handling')","val(d,'storage')+val(d,'contractStorage')+val(d,'handling')"),
("['storage','handling','drayage'","['storage','contractStorage','handling','drayage'"),
("(m.storage||0)+(m.handling||0)","(m.storage||0)+(m.contractStorage||0)+(m.handling||0)"),
("relationshipVal(r,'storage')+relationshipVal(r,'handling')","relationshipVal(r,'storage')+relationshipVal(r,'contractStorage')+relationshipVal(r,'handling')"),
("storage:val(c,'storage'),handling:","storage:val(c,'storage'),contractStorage:val(c,'contractStorage'),handling:"),
("<span>Storage</span><strong>{money(relationshipVal(selected,'storage'))}</strong>","<span>Storage</span><strong>{money(relationshipVal(selected,'storage'))}</strong>"),
("<div><span>Handling</span><strong>{money(relationshipVal(selected,'handling'))}</strong></div>","<div><span>Contract storage</span><strong>{money(relationshipVal(selected,'contractStorage'))}</strong></div><div><span>Handling</span><strong>{money(relationshipVal(selected,'handling'))}</strong></div>"),
("{name:'Storage',value:relationshipVal(selected,'storage')},{name:'Handling'","{name:'Storage',value:relationshipVal(selected,'storage')},{name:'Contract storage',value:relationshipVal(selected,'contractStorage')},{name:'Handling'"),
("<div><span>Handling billed</span><strong>{compact(total('handling'))}</strong></div>","<div><span>Contract storage</span><strong>{compact(total('contractStorage'))}</strong></div><div><span>Handling billed</span><strong>{compact(total('handling'))}</strong></div>"),
("<th>Storage</th><th>Handling</th>","<th>Storage</th><th>Contract storage</th><th>Handling</th>"),
("<td>{money(d.storage)}</td><td>{money(d.handling)}</td>","<td>{money(d.storage)}</td><td>{money(d.contractStorage)}</td><td>{money(d.handling)}</td>"),
("<td>{money(relationshipVal(r,'storage'))}</td><td>{money(relationshipVal(r,'handling'))}</td>","<td>{money(relationshipVal(r,'storage'))}</td><td>{money(relationshipVal(r,'contractStorage'))}</td><td>{money(relationshipVal(r,'handling'))}</td>"),
("{name:'Storage',value:total('storage')},{name:'Handling'","{name:'Storage',value:total('storage')},{name:'Contract storage',value:total('contractStorage')},{name:'Handling'"),
("Storage + handling billing + estimated warehouse-connected OTR GP","Storage + contract storage + handling billing + estimated warehouse-connected OTR GP"),
("Storage + handling revenue + estimated connected OTR gross profit","Storage + contract storage + handling revenue + estimated connected OTR gross profit"),
]
for old,new in changes:
 if old==new:continue
 if old not in s:raise SystemExit(f'Expected UI anchor missing: {old[:90]}')
 s=s.replace(old,new)
p.write_text(s,encoding='utf-8')
print('Updated',p)
