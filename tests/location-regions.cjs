const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const regions=require('../location-regions.js'),accuracy=require('../search-accuracy.js');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function source(name){return html.match(new RegExp('^(?:async )?function '+name+'\\([^]*?^}', 'm'))[0];}
test('state picker finds full names and abbreviations without a geocoder',()=>{
 assert.equal(regions.suggestions('New Jersey','us')[0].scope,'region');
 assert.equal(regions.exact('NJ').name,'New Jersey');
 assert.equal(regions.exact('New Jersey, United States').name,'New Jersey');
 assert.equal(regions.suggestions('New Jersey','in').length,0);
 assert.equal(regions.exact('New York City','us'),null);
});
test('selected and restored states preserve scope; selecting a city clears statewide scope',()=>{
 const values={locationInput:{value:'New Jersey'},filterCountry:{value:'us',selectedIndex:0,options:[{text:'United States'}]}};
 const ctx=vm.createContext({FJRegions:regions,selectedCity:null,document:{getElementById:id=>values[id]||{value:''}},URLSearchParams,location:{search:'?location_scope=region'}});
 vm.runInContext(source('getFilters'),ctx);
 let f=ctx.getFilters();assert.equal(f.location_scope,'region');assert.equal(f.region,'New Jersey');assert.equal(f.city,'');assert.equal(f.country,'us');
 ctx.selectedCity={name:'Edison',region:'New Jersey',scope:'city',lat:40,lng:-74,country_code:'us'};
 f=ctx.getFilters();assert.equal(f.location_scope,'');assert.equal(f.city,'Edison');
 ctx.selectedCity={name:'',region:'New Jersey',scope:'region',country_code:'us',lat:null,lng:null};
 f=ctx.getFilters();assert.equal(f.location_scope,'region');assert.equal(f.latitude,null);
 vm.runInContext(source('filtersToSave'),ctx);assert.equal(ctx.filtersToSave(f).location_scope,'region');
});
test('a country selection searches nationwide, including an old URL that called it a city',()=>{
 assert.equal(regions.countryExact('United States').country_code,'us');
 assert.equal(regions.countryExact('Canada').country_code,'ca');
 for (const file of ['index.html','find-jobs.html','results.html']) {
  const page=fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8');
  const getFilters=page.match(/^function getFilters\(\) \{[^]*?^\}/m)[0];
  const values={locationInput:{value:'United States'},filterCountry:{value:'us',selectedIndex:0,options:[{text:'United States'}]}};
  const ctx=vm.createContext({FJRegions:regions,selectedCity:{name:'United States',country:'United States',scope:'city',lat:39.76,lng:-98.5},document:{getElementById:id=>values[id]||{value:''}}});
  vm.runInContext(getFilters,ctx);
  const filters=ctx.getFilters();
  assert.equal(filters.country,'us',file);
  assert.equal(filters.location,'',file);
  assert.equal(filters.city,'',file);
  assert.equal(filters.latitude,null,file);
  assert.equal(accuracy.matches({job_title:'Data Analyst',location:'Madison, Madison County',country:'us',apply_url:'https://example.com/jobs/1'},'Data Analyst',filters),true,file);
 }
});
test('state matching accepts multiple NJ cities, ZIP codes and state-only listings; rejects NY and unknown',()=>{
 const filters={location:'New Jersey',region:'New Jersey',location_scope:'region',country:'us'};
 const base={job_title:'Data Analyst',country:'us',apply_url:'https://example.com/jobs/1'};
 for(const location of ['Edison, NJ','Newark, New Jersey','Jersey City, NJ 07302','New Jersey'])assert.equal(accuracy.matches({...base,location},'data analyst',filters),true,location);
 for(const location of ['New York, NY','Remote','Edison'])assert.equal(accuracy.matches({...base,location},'data analyst',filters),false,location);
});
test('state database restriction is applied before candidate limit',()=>{
 const ctx=vm.createContext({FJRegions:regions,SUPABASE_URL:'https://example.com',QUICK_CANDIDATE_LIMIT:300,encodeURIComponent});vm.runInContext(source('quickMatchUrl'),ctx);
 const url=new URL(ctx.quickMatchUrl(['data','analyst'],{country:'us',location_scope:'region',region:'New Jersey'},false));
 assert.ok(url.searchParams.get('and').includes('location.ilike.*New Jersey*'));
 assert.ok(url.searchParams.get('and').includes('location.ilike."*, NJ*"'));
 assert.equal(url.searchParams.has('or'),false);
 assert.equal(url.searchParams.get('closed_at'),'is.null');
 assert.equal(url.searchParams.get('order'),'posted_at.desc.nullslast');
 assert.ok(url.searchParams.get('select').split(',').includes('source'));
 assert.ok(!url.searchParams.get('select').split(',').includes('source_metadata')); 
});
