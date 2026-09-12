import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID, randomBytes, createHash} from 'node:crypto';
const project='mlciopffwtbopluuahoj';
const base=`https://${project}.supabase.co`;
const cli='/Users/f4f/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase';
const directory=process.argv[2];
if(!directory?.startsWith('/tmp/rppl-hosted-recovery.')) throw new Error('Private recovery directory required');
const raw=execFileSync(cli,['projects','api-keys','--project-ref',project,'--output','json'],{encoding:'utf8'});
const keys=JSON.parse(raw);
const service=keys.find(k=>k.name==='service_role')?.api_key;
const anon=keys.find(k=>k.name==='anon')?.api_key;
if(!service||!anon) throw new Error('Expected test-project API keys not available');
function query(sql,name) {
 const file=path.join(directory,name+'.sql');fs.writeFileSync(file,sql,{mode:0o600});
 const result=execFileSync(cli,['db','query','--linked','--project-ref',project,'--file',file,'--output','json'],{encoding:'utf8',maxBuffer:10*1024*1024});
 return JSON.parse(result.slice(result.indexOf('{'))).rows;
}
async function request(url,{token=service,method='GET',body,raw=false,headers={}}={}) {
 const response=await fetch(base+url,{method,headers:{apikey:token===service?service:anon,Authorization:`Bearer ${token}`,...(body&&!raw?{'Content-Type':'application/json'}:{}),...headers},body:body?(raw?body:JSON.stringify(body)):undefined,signal:AbortSignal.timeout(30000)});
 const value=raw&&method==='GET'?Buffer.from(await response.arrayBuffer()):await response.json().catch(()=>null);
 return {ok:response.ok,status:response.status,value};
}
function requireOK(result,label) { if(!result.ok) throw new Error(`${label} failed: HTTP ${result.status}, code ${result.value?.code??result.value?.error_code??'unknown'}`);return result.value; }
const skipAvatars=process.argv.includes('--skip-avatars');
const manifest=skipAvatars?{objects:[]}:JSON.parse(fs.readFileSync(path.join(directory,'avatars/manifest.json'),'utf8'));
const bucket=await request('/storage/v1/bucket/avatars');
if(!bucket.ok) requireOK(await request('/storage/v1/bucket',{method:'POST',body:{id:'avatars',name:'avatars',public:false}}),'Create private test avatar bucket');
else if(bucket.value.public) throw new Error('Test avatar bucket must remain private');
for(const object of process.argv.includes('--skip-avatars')?[]:manifest.objects) {
 const bytes=fs.readFileSync(path.join(directory,'avatars',object.file));
 if(createHash('sha256').update(bytes).digest('hex')!==object.sha256) throw new Error('Backup avatar hash mismatch');
 const url='/storage/v1/object/avatars/'+object.name.split('/').map(encodeURIComponent).join('/');
 const metadata=JSON.parse(object.databaseMetadata||'{}');
 requireOK(await request(url,{method:'POST',body:bytes,raw:true,headers:{'Content-Type':metadata.mimetype||'application/octet-stream','x-upsert':'true'}}),'Upload avatar');
 const downloaded=requireOK(await request(url,{raw:true}),'Read restored avatar');
 if(createHash('sha256').update(downloaded).digest('hex')!==object.sha256) throw new Error('Restored avatar hash mismatch');
}
if(!skipAvatars) console.log(`Restored and byte-verified ${manifest.objects.length} avatars in a private test bucket.`);
const functions='public.save_my_social_profile(text,text,boolean), public.get_listener_profile(text), public.get_listener_music(text,integer), public.follow_listener(uuid), public.unfollow_listener(uuid), public.respond_to_follow_request(uuid,boolean), public.get_share_card_top_rated(text,integer)';
query(`BEGIN; GRANT USAGE ON SCHEMA public TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON public.listen_list TO authenticated; GRANT EXECUTE ON FUNCTION ${functions} TO authenticated; NOTIFY pgrst,'reload schema'; COMMIT;`,'probe-grants');
const users=[];
try {
 for(let i=0;i<2;i++) {
  const email=`rppl-recovery-${randomUUID()}@example.com`,password=randomBytes(30).toString('base64url');
  const created=requireOK(await request('/auth/v1/admin/users',{method:'POST',body:{email,password,email_confirm:true}}),'Create temporary auth probe');
  users.push({id:created.id});
  const login=requireOK(await request('/auth/v1/token?grant_type=password',{method:'POST',token:anon,body:{email,password}}),'Sign in');
  users.at(-1).token=login.access_token;
 }
 const [a,b]=users;
 const rpc=async(name,token,body)=>requireOK(await request('/rest/v1/rpc/'+name,{method:'POST',token,body}),name);
 const username='recovery'+randomBytes(4).toString('hex');
 const profile=await rpc('save_my_social_profile',a.token,{p_username:username,p_display_name:'Recovery Probe',p_is_private:true});
 const own=requireOK(await request('/rest/v1/listen_list',{method:'POST',token:a.token,headers:{Prefer:'return=representation'},body:{user_id:a.id,provider:'spotify',provider_id:'recovery-'+randomUUID(),title:'Recovery test release',artist_name:'RPPL test',item_type:'track',artwork_url:'https://example.com/recovery.png'}}),'Save owned release');
 if(own.length!==1) throw new Error('Save did not return one row');
 const id=own[0].id;
 const other=requireOK(await request('/rest/v1/listen_list?id=eq.'+id,{token:b.token}),'Cross-account read');
 if(other.length!==0) throw new Error('Ownership isolation failed');
 const forged=await request('/rest/v1/listen_list',{method:'POST',token:b.token,body:{user_id:a.id,provider:'spotify',provider_id:'forged-'+randomUUID(),title:'Should not save'}});
 if(forged.ok||forged.value?.code!=='42501') throw new Error('Cross-account insertion was not rejected by RLS');
 const changed=requireOK(await request('/rest/v1/listen_list?id=eq.'+id,{method:'PATCH',token:a.token,headers:{Prefer:'return=representation'},body:{rating:8,status:'listened',done_at:new Date().toISOString(),rated_at:new Date().toISOString()}}),'Rate and mark listened');
 if(changed[0]?.rating!==8||changed[0]?.status!=='listened') throw new Error('Rating did not persist');
 const privateMusic=await rpc('get_listener_music',b.token,{p_username:username,p_limit:12});
 if(privateMusic.length!==0) throw new Error('Private history visible before following');
 const shareMusic=await rpc('get_share_card_top_rated',b.token,{p_public_id:profile[0].public_id,p_limit:3});
 const shareCardPrivacyPassed=shareMusic.length===0;
 if(!shareCardPrivacyPassed) throw new Error('Unrelated account can read private share card');
 const share=token=>rpc('get_share_card_top_rated',token,{p_public_id:profile[0].public_id,p_limit:3});
 if(!(await share(a.token)).some(row=>row.id===id)) throw new Error('Owner cannot read share card');
 await rpc('follow_listener',b.token,{p_user_id:a.id});
 const pendingMusic=await rpc('get_listener_music',b.token,{p_username:username,p_limit:12});
 if(pendingMusic.length!==0) throw new Error('Private history visible while request pending');
 if((await share(b.token)).length!==0) throw new Error('Pending follower can read private share card');
 await rpc('respond_to_follow_request',a.token,{p_follower_id:b.id,p_accept:true});
 const acceptedMusic=await rpc('get_listener_music',b.token,{p_username:username,p_limit:12});
 if(!acceptedMusic.some(row=>row.id===id)) throw new Error('Accepted follower cannot see test history');
 if(!(await share(b.token)).some(row=>row.id===id)) throw new Error('Accepted follower cannot read share card');
 await rpc('unfollow_listener',b.token,{p_user_id:a.id});
 if((await share(b.token)).length!==0) throw new Error('Former follower can read private share card');
 await rpc('save_my_social_profile',a.token,{p_username:username,p_display_name:'Recovery Probe',p_is_private:false});
 if(!(await share(b.token)).some(row=>row.id===id)) throw new Error('Public share card unavailable');
 const missing=await rpc('get_share_card_top_rated',b.token,{p_public_id:'missing-'+randomUUID(),p_limit:3});
 if(missing.length!==0) throw new Error('Unknown share identifier returned data');
 const anonymousShare=await request('/rest/v1/rpc/get_share_card_top_rated',{method:'POST',token:anon,body:{p_public_id:profile[0].public_id,p_limit:3}});
 if(anonymousShare.ok&&anonymousShare.value?.length) throw new Error('Anonymous share-card data exposed');
 console.log('Share-card checks passed: owner, unrelated, pending, accepted, former follower, public, missing identifier and anonymous.');
 const anonymous=await request('/rest/v1/listen_list',{token:anon});
 if(anonymous.ok && anonymous.value?.length) throw new Error('Anonymous access revealed rows');
 console.log('Temporary-account sign-in, own save/rating, cross-account read isolation and forged-owner rejection passed.');
 console.log('Profile setup, private history and follow-request acceptance passed. Share-card privacy: '+(shareCardPrivacyPassed?'passed':'FAILED — separate share-card RPC returns private test rating to an unrelated account'));
 fs.writeFileSync(path.join(directory,'services-verification.json'),JSON.stringify({avatars:manifest.objects.length,authSignIn:true,ownSaveAndRating:true,crossAccountReadBlocked:true,crossAccountInsertBlocked:true,anonymousDataBlocked:true,profileSetup:true,followRequestPrivacy:true,shareCardPrivacyPassed,temporaryAccountsOnly:true}),{mode:0o600});
} finally {
 for(const user of users) requireOK(await request('/auth/v1/admin/users/'+user.id,{method:'DELETE'}),'Remove temporary auth probe');
 query(`REVOKE SELECT,INSERT,UPDATE,DELETE ON public.listen_list FROM authenticated; REVOKE EXECUTE ON FUNCTION ${functions} FROM authenticated;`,'close-probe-access');
}
