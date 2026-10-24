(() => {
  'use strict';
  const form=document.getElementById('resumeForm');
  const ids=['name','email','phone','location','link','target','summary','skills','experience','education','projects'];
  const preview=document.getElementById('preview'),advice=document.getElementById('advice');
  const value=()=>Object.fromEntries(ids.map(id=>[id,document.getElementById(id).value]));
  const el=(tag,text,cls)=>{const node=document.createElement(tag);node.textContent=text;if(cls)node.className=cls;return node;};
  function section(label,content,list=false){
    if(!content || Array.isArray(content)&&!content.length)return;
    preview.append(el('h3',label));
    if(list){const ul=document.createElement('ul');content.forEach(item=>ul.append(el('li',item)));preview.append(ul);}
    else preview.append(el('p',content));
  }
  function render(){
    const data=FJResumeBuilder.draft(value());
    preview.replaceChildren(el('h2',data.name||'Your name'),el('p',data.target||'Target role','role'));
    const contact=[data.email,data.phone,data.location].filter(Boolean);
    if(data.link){try{const url=new URL(data.link);if(['https:','http:'].includes(url.protocol))contact.push(url.href);}catch{}}
    preview.append(el('p',contact.join('  ·  ')||'Add a contact method','contact'));
    section('Profile',data.summary);section('Experience',data.experience,true);section('Skills',data.skills,true);section('Education',data.education,true);section('Projects',data.projects,true);
    const tips=FJResumeBuilder.advice(data);advice.replaceChildren(el('strong',tips.length?'Before you export':'Ready to review'));
    if(tips.length){const ul=document.createElement('ul');tips.forEach(tip=>ul.append(el('li',tip)));advice.append(ul);}
    else advice.append(el('p','Check every statement against your own records.'));
    document.getElementById('export').disabled=!document.getElementById('confirmed').checked||!data.name||(!data.email&&!data.phone);
  }
  form.addEventListener('input',render);form.addEventListener('change',render);
  form.addEventListener('submit',event=>event.preventDefault());
  document.getElementById('export').addEventListener('click',()=>{render();if(!document.getElementById('export').disabled)window.print();});
  document.getElementById('clear').addEventListener('click',()=>{if(!window.confirm('Clear all résumé details in this tab?'))return;form.reset();render();});
  render();
})();
