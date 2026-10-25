(() => {
  'use strict';
  const form=document.getElementById('resumeForm');
  const ids=['name','email','phone','location','link','target','summary','skills','experience','education','projects'];
  const preview=document.getElementById('preview'),advice=document.getElementById('advice');
  let importGeneration=0,importSuggestions=null,profileGeneration=0,profileSuggestions=null;
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
  document.getElementById('clear').addEventListener('click',()=>{if(!window.confirm('Clear all résumé details in this tab?'))return;++importGeneration;++profileGeneration;importSuggestions=null;profileSuggestions=null;document.getElementById('sourceText').textContent='';document.getElementById('sourceDetails').hidden=true;document.getElementById('useSuggestions').hidden=true;document.getElementById('importStatus').textContent='';document.getElementById('profilePreview').replaceChildren();document.getElementById('profilePreview').hidden=true;document.getElementById('useProfile').hidden=true;document.getElementById('profileSignIn').hidden=true;document.getElementById('profileStatus').textContent='';form.reset();render();});
  document.getElementById('loadProfile').addEventListener('click',async()=>{
    const generation=++profileGeneration,status=document.getElementById('profileStatus');
    profileSuggestions=null;document.getElementById('profilePreview').replaceChildren();document.getElementById('profilePreview').hidden=true;document.getElementById('useProfile').hidden=true;document.getElementById('profileSignIn').hidden=true;
    status.textContent='Reading your saved profile…';
    try{
      if(!window.FJ)throw new Error('Accounts are unavailable right now. Try again later.');
      const user=await FJ.user();if(generation!==profileGeneration)return;
      if(!user){status.textContent='Sign in to read your saved profile, or keep using the blank form.';document.getElementById('profileSignIn').hidden=false;return;}
      const {data,error}=await FJ.sb.from('profiles').select('full_name,email,current_title,skills,preferred_locations').eq('id',user.id).maybeSingle();
      if(generation!==profileGeneration)return;
      if(error)throw new Error('Could not read your profile. Try again later.');
      profileSuggestions=FJResumeBuilder.profileSuggestions(data,user.email);
      const labels={name:'Name',email:'Email',target:'Current title',skills:'Confirmed skills',location:'Preferred location'};
      const list=document.getElementById('profilePreview');
      for(const [key,label] of Object.entries(labels))if(profileSuggestions[key])list.append(el('li',label+': '+profileSuggestions[key].replace(/\n/g,', ')));
      if(!list.childNodes.length){status.textContent='Your profile has no details to add yet. You can fill the form directly.';return;}
      list.hidden=false;document.getElementById('useProfile').hidden=false;
      status.textContent='Review these saved details before adding them to empty fields.';
    }catch(error){if(generation!==profileGeneration)return;status.textContent=error.message||'Could not read your profile. Try again later.';}
  });
  document.getElementById('useProfile').addEventListener('click',()=>{
    if(!profileSuggestions)return;
    for(const [key,suggestion] of Object.entries(profileSuggestions)){
      const field=document.getElementById(key);if(field&&suggestion&&!field.value.trim())field.value=suggestion;
    }
    document.getElementById('confirmed').checked=false;render();
    document.getElementById('profileStatus').textContent='Profile details added to empty fields. Check every fact before exporting; your saved profile has not changed.';
  });
  document.getElementById('importFile').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    const generation=++importGeneration,status=document.getElementById('importStatus');
    importSuggestions=null;document.getElementById('useSuggestions').hidden=true;
    document.getElementById('sourceDetails').hidden=true;
    document.getElementById('sourceText').textContent='';
    status.textContent='Reading your résumé in this browser…';
    try{
      const ext=file.name.split('.').pop().toLowerCase();
      if(!['pdf','docx'].includes(ext)||!file.size||file.size>5*1024*1024)throw new Error('Choose a text-based PDF or DOCX under 5 MB.');
      let text;
      if(ext==='pdf')text=await (await import('./resume-extraction.mjs')).pdfToText(file);
      else {if(!window.mammoth)throw new Error('The DOCX reader is still loading. Try again.');text=(await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value.trim();}
      if(generation!==importGeneration)return;
      if(text.replace(/\s/g,'').length<30||text.length>60000)throw new Error('The document has no readable text or is too long. Scanned PDFs need OCR first.');
      importSuggestions=FJResume.suggest(text);
      document.getElementById('sourceText').textContent=text;
      document.getElementById('sourceDetails').hidden=false;
      document.getElementById('useSuggestions').hidden=!(importSuggestions.current_title||importSuggestions.skills.length);
      status.textContent='Read locally. Review the extracted text, then choose whether to use the suggested title and skills. Copy only facts you want in the résumé.';
    }catch(error){if(generation!==importGeneration)return;status.textContent=error.name==='PasswordException'?'Remove the PDF password and try again.':error.message||'Could not read this document.';}
  });
  document.getElementById('useSuggestions').addEventListener('click',()=>{
    if(!importSuggestions)return;
    if(importSuggestions.current_title&&!document.getElementById('target').value)document.getElementById('target').value=importSuggestions.current_title;
    if(importSuggestions.skills.length&&!document.getElementById('skills').value)document.getElementById('skills').value=importSuggestions.skills.join('\n');
    document.getElementById('confirmed').checked=false;render();
    document.getElementById('importStatus').textContent='Suggestions added where fields were blank. Check them carefully and enter your own experience and education.';
  });
  render();
})();
