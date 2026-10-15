(async function(){
 const box=document.getElementById('weekly'),save=document.getElementById('save'),status=document.getElementById('status');
 const setStatus=data=>{box.checked=data.subscribed;status.textContent=data.delivery_active?'Preference saved. Weekly emails follow your choice.':'Preference saved. Newsletter delivery is not active yet; we’ll use this choice when it launches.';};
 async function request(body){
  const {data,error}=await FJ.sb.auth.getSession();if(error||!data?.session)throw Error('Please sign in to manage email preferences.');
  const r=await fetch(FJ_CONFIG.url+'/functions/v1/email-preferences',{method:body?'POST':'GET',headers:{apikey:FJ_CONFIG.key,Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Newsletter preferences are not available yet. Your choice has not been changed.');
  return r.json();
 }
 try{
  if(!window.FJ)throw Error('Accounts are temporarily unavailable.');
  if(!await FJ.user()){status.textContent='Sign in to manage your email preferences.';const a=document.createElement('a');a.href='login.html?next=email-preferences.html';a.textContent=' Sign in';status.append(a);return;}
  const current=await request();box.checked=current.subscribed;status.textContent=current.delivery_active?'Your current email preference is shown above.':'Newsletter delivery is not active yet. You can choose whether to receive it when it launches.';box.disabled=false;save.disabled=false;
 }catch(e){status.textContent=e.message;}
 document.getElementById('preferences').addEventListener('submit',async e=>{
  e.preventDefault();if(save.disabled)return;save.disabled=true;box.disabled=true;
  try{setStatus(await request({subscribed:box.checked,consent_version:'weekly-v1'}));}catch(e){status.textContent=e.message;}
  finally{save.disabled=false;box.disabled=false;}
 });
})();