import importlib.util,unittest,pathlib,tempfile,zipfile,datetime
root=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('lca',root/'scripts/h1b/import_lca.py');lca=importlib.util.module_from_spec(spec);spec.loader.exec_module(lca)
def row(n,**kw):
 r=dict(CASE_NUMBER='CASE-'+str(n),CASE_STATUS='Certified',VISA_CLASS='H-1B',EMPLOYER_NAME='Example, Incorporated',WORKSITE_STATE='NJ',SOC_CODE='15-2051.00',JOB_TITLE='Data Analyst',WAGE_RATE_OF_PAY_FROM='100000',WAGE_RATE_OF_PAY_TO='120000',WAGE_UNIT_OF_PAY='Year',FULL_TIME_POSITION='Y');r.update(kw);return r
class ImportTest(unittest.TestCase):
 def test_mapping_and_entity_identity(self):
  self.assertEqual(lca.role_for('15-2051.00','Data Analyst'),'data-analyst');self.assertEqual(lca.role_for('13-1111','Data Analyst'),'data-analyst')
  self.assertIsNone(lca.role_for('15-2051','Analyst'));self.assertIsNone(lca.role_for('29-1141','Data Analyst'));self.assertEqual(lca.role_for('15-1252','Data Engineer'),'data-engineer')
  self.assertEqual(lca.employer_key('A&B, Incorporated'),'a and b inc');self.assertNotEqual(lca.employer_key('Example Inc'),lca.employer_key('Example LLC'));self.assertNotEqual(lca.employer_key('Oracle America Inc'),lca.employer_key('Oracle'))
 def test_status_dedup_count_and_median(self):
  data=lca.aggregate([(2026,1,[row(1),row(2),row(3,VISA_CLASS='E-3'),row(4,JOB_TITLE='Unknown')]),(2026,4,[row(1,CASE_STATUS='Withdrawn'),row(5,WAGE_RATE_OF_PAY_FROM='80000',WAGE_RATE_OF_PAY_TO='80000')])],2026,2027)
  self.assertEqual(len(data['rows']),1);self.assertEqual(data['rows'][0]['certified_lcas'],2);self.assertEqual(data['rows'][0]['median_wage_annual'],95000)
  self.assertEqual(set(data['rows'][0]),{'employer_key','employer_name','state_code','soc_code','role_id','fiscal_year','certified_lcas','median_wage_annual','updated_at'})
  self.assertNotIn('CASE_NUMBER',str(data));self.assertNotIn('CASE-1',str(data))
 def test_annualisation_and_part_time(self):
  self.assertEqual(lca.annual_cents(row(1,WAGE_RATE_OF_PAY_FROM='50',WAGE_RATE_OF_PAY_TO='',WAGE_UNIT_OF_PAY='Hour')),10400000)
  self.assertIsNone(lca.annual_cents(row(1,WAGE_UNIT_OF_PAY='Hour',FULL_TIME_POSITION='N')))
 def test_source_discovery_requires_full_year_and_only_dol(self):
  html=''.join(f'<a href="/sites/dolgov/files/LCA_Dislclosure_Data_FY2026_Q{q}.xlsx">LCA</a>' for q in range(1,5))
  fy,current,files=lca.discover(html,datetime.date(2026,11,24));self.assertEqual((fy,current,len(files)),(2026,2027,4))
  self.assertFalse(lca.official('https://dol.gov.attacker.test/file.xlsx'));self.assertFalse(lca.official('https://user:pass@dol.gov/file.xlsx'))
  with self.assertRaises(ValueError):lca.discover(html.replace('Q4.xlsx','Q3.xlsx'),datetime.date(2026,11,24))
 def test_xlsx_reader_selects_only_permitted_columns(self):
  headers=sorted(lca.REQUIRED|{'ATTORNEY_NAME'});values=row(1);values['ATTORNEY_NAME']='Not exported'
  def cells(items):return ''.join(f'<c r="{self.col(i)}" t="inlineStr"><is><t>{value}</t></is></c>' for i,value in enumerate(items))
  xml='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row>'+cells(headers)+'</row><row>'+cells([values[k] for k in headers])+'</row></sheetData></worksheet>'
  with tempfile.TemporaryDirectory() as tmp:
   path=pathlib.Path(tmp)/'fixture.xlsx'
   with zipfile.ZipFile(path,'w') as z:
    z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="data" sheetId="1" r:id="r1"/></sheets></workbook>')
    z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>');z.writestr('xl/worksheets/sheet1.xml',xml)
   result=list(lca.xlsx_rows(path));self.assertEqual(len(result),1);self.assertEqual(result[0]['EMPLOYER_NAME'],'Example, Incorporated');self.assertNotIn('ATTORNEY_NAME',result[0])
 @staticmethod
 def col(i):
  out='';i+=1
  while i:i,n=divmod(i-1,26);out=chr(65+n)+out
  return out+'1'
