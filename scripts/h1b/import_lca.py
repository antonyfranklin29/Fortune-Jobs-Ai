"""Stream official DOL LCA XLSX files into employer-only aggregates (stdlib only)."""
import argparse, collections, datetime, decimal, hashlib, html.parser, json, math, pathlib, re, sqlite3, statistics, tempfile, urllib.parse, urllib.request, xml.etree.ElementTree as ET, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = 'https://www.dol.gov/agencies/eta/foreign-labor/performance'
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
NEEDED = {'CASE_NUMBER','CASE_STATUS','VISA_CLASS','EMPLOYER_NAME','WORKSITE_STATE','SOC_CODE','JOB_TITLE','WAGE_RATE_OF_PAY_FROM','WAGE_RATE_OF_PAY_TO','WAGE_UNIT_OF_PAY','FULL_TIME_POSITION'}
REQUIRED = NEEDED - {'WAGE_RATE_OF_PAY_TO','FULL_TIME_POSITION'}

def employer_key(name):
    tokens = re.sub(r'[^a-z0-9]+', ' ', str(name or '').lower().replace('&',' and ')).strip().split()
    return ' '.join({'incorporated':'inc','corporation':'corp','limited':'ltd'}.get(t,t) for t in tokens)

def mapping_rules():
    data = json.loads((ROOT/'config/h1b-soc-roles.json').read_text(encoding='utf-8'))
    return [(r['role_id'],set(r['soc_codes']),[re.compile(p,re.I) for p in r['include']],[re.compile(p,re.I) for p in r['exclude']]) for r in data['rules']]
RULES = mapping_rules()
def role_for(soc, title):
    hit = re.match(r'\d{2}-\d{4}',str(soc or ''))
    if not hit: return None
    return next((role for role,codes,incs,excs in RULES if hit[0] in codes and any(p.search(title) for p in incs) and not any(p.search(title) for p in excs)), None)

def annual_cents(row):
    try:
        number = lambda x: decimal.Decimal(str(x).replace(',','').replace('$','').strip())
        low=number(row.get('WAGE_RATE_OF_PAY_FROM','')); high=number(row.get('WAGE_RATE_OF_PAY_TO') or low)
        if not low.is_finite() or not high.is_finite() or low<=0 or high<low: return None
        unit=str(row.get('WAGE_UNIT_OF_PAY','')).lower().replace('-','').replace(' ','')
        factor={'year':1,'hour':2080,'week':52,'biweekly':26,'month':12}.get(unit)
        if factor is None or (unit!='year' and str(row.get('FULL_TIME_POSITION','')).upper()!='Y'): return None
        return int((low+high)/2*factor*100)  # floor to cents; never inflate a reported amount
    except (decimal.InvalidOperation,ValueError,TypeError): return None

def xlsx_rows(path):
    # No workbook is authored; XML is read sequentially and only needed columns leave this reader.
    with zipfile.ZipFile(path) as archive:
        strings=[]
        if 'xl/sharedStrings.xml' in archive.namelist():
            with archive.open('xl/sharedStrings.xml') as data:
                for _,node in ET.iterparse(data,events=('end',)):
                    if node.tag==NS+'si': strings.append(''.join(t.text or '' for t in node.iter(NS+'t')));node.clear()
        workbook=ET.fromstring(archive.read('xl/workbook.xml'))
        first=workbook.find(NS+'sheets')[0]
        rid=first.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
        rels=ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        target=next(r.attrib['Target'] for r in rels if r.attrib['Id']==rid)
        member=target.lstrip('/') if target.startswith('/') else 'xl/'+target
        headers=None
        with archive.open(member) as data:
            context=ET.iterparse(data,events=('start','end')); _,root=next(context)
            for event,node in context:
                if event!='end' or node.tag!=NS+'row': continue
                values={}
                for cell in node.findall(NS+'c'):
                    letters=re.match('[A-Z]+',cell.attrib.get('r','A'))[0];idx=0
                    for letter in letters:idx=idx*26+ord(letter)-64
                    idx-=1
                    if headers is not None and headers.get(idx) not in NEEDED:continue
                    val=cell.find(NS+'v');text=val.text if val is not None else ''.join(t.text or '' for t in cell.iter(NS+'t'))
                    if cell.attrib.get('t')=='s' and text is not None:text=strings[int(text)]
                    values[idx]=text or ''
                if headers is None:
                    headers={i:re.sub(r'[^A-Z0-9]+','_',str(v).strip().upper()).strip('_') for i,v in values.items()}
                    if not REQUIRED.issubset(headers.values()):raise ValueError('DOL workbook columns changed; refusing an incomplete import')
                else:yield {headers[i]:v for i,v in values.items() if headers.get(i) in NEEDED}
                root.clear()

def aggregate(sources,latest_full_fy,current_fy):
    # SQLite bounds RAM and deduplicates the latest quarterly determination before status filtering.
    db=sqlite3.connect('')
    db.execute('create table cases(fy integer,id text,quarter integer,status text,visa text,employer_key text,name text,state text,soc text,role text,cents integer,primary key(fy,id))')
    state_codes={r['code'] for r in json.loads((ROOT/'config/us-regions.json').read_text())['regions']}
    seen=0
    for fy,quarter,records in sorted(sources,key=lambda src:(src[0],src[1])):
        for row in records:
            seen+=1;raw_id=str(row.get('CASE_NUMBER','')).strip()
            if not raw_id:raise ValueError('Missing case identity; cannot deduplicate safely')
            name=str(row.get('EMPLOYER_NAME','')).strip();key=employer_key(name);state=str(row.get('WORKSITE_STATE','')).upper().strip();soc=str(row.get('SOC_CODE','')).strip()
            role=role_for(soc,str(row.get('JOB_TITLE','')));valid=key and state in state_codes and role and not re.match(r'^jobg8(?:\b|$)',name,re.I)
            db.execute('insert into cases values(?,?,?,?,?,?,?,?,?,?,?) on conflict(fy,id) do update set quarter=excluded.quarter,status=excluded.status,visa=excluded.visa,employer_key=excluded.employer_key,name=excluded.name,state=excluded.state,soc=excluded.soc,role=excluded.role,cents=excluded.cents',
              (fy,hashlib.sha256(raw_id.encode()).hexdigest(),quarter,str(row.get('CASE_STATUS','')).strip().lower(),str(row.get('VISA_CLASS','')).strip().upper(),key if valid else None,name,state,soc,role,annual_cents(row)))
    db.execute('create index wage_groups on cases(employer_key,state,soc,role,fy)');db.commit();output=[];stamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
    cursor=db.execute("select employer_key,min(name),state,soc,role,fy,count(*) from cases where status='certified' and visa='H-1B' and employer_key is not null group by employer_key,state,soc,role,fy order by employer_key,state,soc,role,fy")
    for key,name,state,soc,role,fy,count in cursor:
        wages=[r[0] for r in db.execute("select cents from cases where employer_key=? and state=? and soc=? and role=? and fy=? and status='certified' and visa='H-1B' and cents is not null",(key,state,soc,role,fy))]
        median=math.floor(statistics.median(wages))/100 if wages else None
        output.append(dict(employer_key=key,employer_name=name,state_code=state,soc_code=soc,role_id=role,fiscal_year=fy,certified_lcas=count,median_wage_annual=median,updated_at=stamp))
    db.close()
    return {'metadata':{'latest_full_fy':latest_full_fy,'current_fy':current_fy,'updated_at':stamp,'rows_seen':seen,'annualisation':'Year 1; full-time Hour 2080, Week 52, Bi-Weekly 26, Month 12. Part-time nonannual rates excluded from the median, not case counts. First worksite only. One certified LCA is one case, not one worker.','source':SOURCE},'rows':output}

class Links(html.parser.HTMLParser):
    def __init__(self):super().__init__();self.urls=[]
    def handle_starttag(self,tag,attrs):
        if tag=='a':self.urls.extend(v for k,v in attrs if k=='href')
def official(url):
    parsed=urllib.parse.urlsplit(url)
    return parsed.scheme=='https' and parsed.hostname in {'www.dol.gov','dol.gov'} and not parsed.username and not parsed.password
class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        if not official(newurl):raise ValueError('Disclosure download redirected outside dol.gov')
        return super().redirect_request(req,fp,code,msg,headers,newurl)
def fetch(url,path=None):
    if not official(url):raise ValueError('Only official HTTPS DOL sources are permitted')
    opener=urllib.request.build_opener(OfficialRedirect)
    with opener.open(urllib.request.Request(url,headers={'User-Agent':'FortuneJobsAI/1.0 (+https://fortunejobsai.com)'}),timeout=120) as response:
        if path:
            with open(path,'wb') as target:
                total=0
                while chunk:=response.read(1024*1024):
                    total+=len(chunk)
                    if total>1024*1024*1024:raise ValueError('Workbook exceeded the 1 GiB collection limit')
                    target.write(chunk)
        else:return response.read(8*1024*1024).decode('utf-8')
def discover(document,today):
    parser=Links();parser.feed(document);found={}
    current=today.year+(today.month>=10)
    for href in parser.urls:
        url=urllib.parse.urljoin(SOURCE,href)
        hit=re.search(r'LCA_(?:Disclosure|Dislclosure)_Data_FY(20\d\d)_Q([1-4])\.xlsx',url,re.I)
        if hit and official(url):found[(int(hit[1]),int(hit[2]))]=url
    full=max((fy for fy,q in found if q==4 and fy<current and all((fy,n) in found for n in range(1,5))),default=None)
    if full is None:raise ValueError('No complete latest full-year set found on the DOL page')
    # Do not silently fall back to an older completed year when the immediately preceding FY is missing.
    if full!=current-1:raise ValueError('Latest full fiscal year has not been published completely; previous data is preserved')
    return full,current,[(fy,q,url) for (fy,q),url in sorted(found.items()) if fy in {full,current}]
def hash_file(path):
    with open(path,'rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
    full,current,files=discover(fetch(SOURCE),datetime.date.today())
    with tempfile.TemporaryDirectory(prefix='fortune-h1b-') as directory:
        sources=[];provenance=[]
        for fy,quarter,url in files:
            path=pathlib.Path(directory)/f'{fy}-Q{quarter}.xlsx';fetch(url,path)
            provenance.append({'fiscal_year':fy,'quarter':quarter,'url':url,'sha256':hash_file(path)})
            sources.append((fy,quarter,xlsx_rows(path)))
        result=aggregate(sources,full,current)
        if not result['rows']:raise ValueError('No mapped certified H-1B aggregates; refusing an empty replacement')
        result['metadata']['source_files']=provenance
        pathlib.Path(args.output).write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
        print(json.dumps({'aggregate_rows':len(result['rows']),'latest_full_fy':full,'current_fy':current,'source_files':len(files)}))
if __name__=='__main__':main()
