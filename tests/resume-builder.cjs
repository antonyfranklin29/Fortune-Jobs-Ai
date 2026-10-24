const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const builder=require('../resume-builder.js');

test('résumé draft keeps only supplied facts and never invents credentials or achievements',()=>{
  const data=builder.draft({name:'Franklin Antony',target:'Data Analyst',skills:'SQL\nPython',experience:'Built a verified report.',education:'',projects:''});
  assert.equal(data.name,'Franklin Antony');
  assert.deepEqual(data.skills,['SQL','Python']);
  assert.deepEqual(data.experience,['Built a verified report.']);
  assert.deepEqual(data.education,[]);
  assert.deepEqual(data.projects,[]);
  assert.ok(builder.advice(data).some(tip=>tip.includes('contact method')));
});

test('résumé workspace renders user text as text and gates export on review',()=>{
  const source=fs.readFileSync('resume-builder-page.js','utf8');
  new vm.Script(source);
  assert.match(source,/node\.textContent=text/);
  assert.match(source,/confirmed.*checked/);
  assert.doesNotMatch(source,/innerHTML|fetch\(|localStorage|sessionStorage/);
});
