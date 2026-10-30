# GET-only location enrichment; output stays outside git.
import argparse,csv,json,urllib.request,concurrent.futures,pathlib
p=argparse.ArgumentParser();p.add_argument("--root",required=True);p.add_argument("--env-file",required=True);a=p.parse_args()
root=pathlib.Path(a.root);s=json.load(open(a.env_file))
rows=[x for x in csv.DictReader(open(root/'upload/freshdata.csv',encoding='utf-8-sig')) if x['revenue_code_id']=='DDRAY']
ids=sorted({x[k] for x in rows for k in ['pickup_location_id','delivery_location_id'] if x[k]})
path=root/'combined_context_private/ddray-locations.json'
prior=json.load(open(path)) if path.exists() else {}
def get(id):
 req=urllib.request.Request(s['MCLEOD_BASE_URL'].rstrip('/')+'/locations/'+id,headers={'Authorization':'Bearer '+s['MCLEOD_AUTH_TOKEN'],'Accept':'application/json'})
 r=json.load(urllib.request.urlopen(req,timeout=60))
 assert r['id']==id and r['company_id']=='TMS'
 return id,{k:r.get(k) for k in ['id','company_id','city_name','state','zip_code']}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
 for id,r in pool.map(get,[i for i in ids if i not in prior]):
  prior[id]=r;path.write_text(json.dumps(prior,indent=2));path.chmod(0o600)
print('locations',len(prior))
