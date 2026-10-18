/** Production deploy configuration gate: never accept development credentials or mixed Firebase projects. */
const value=(env,name)=>{
  const v=String(env[name]??'').trim();
  if(!v||/^(YOUR_|REPLACE_|TODO|undefined|null)/i.test(v))throw Error(name+' missing');
  return v;
};
export function verifyProductionDeploy(env=process.env){
  const project=value(env,'GCP_PROD_PROJECT_ID');
  if(!/^[a-z][a-z0-9-]{4,29}$/.test(project)||/(?:^|-)(dev|development|test|staging|sandbox)(?:-|$)/i.test(project))
    throw Error('Production project must be a valid, non-development Google Cloud project ID');
  if(project==='manufusion-mems-development')throw Error('Development Firebase project cannot be used in production');
  if(project==='mems2026' && env.MEMS_ALLOW_LIVE_DATA!=='I_ACKNOWLEDGE_THE_RISK')
    throw Error('MEMS_ALLOW_LIVE_DATA must explicitly authorize the existing live Firebase project');
  if(value(env,'VITE_FIREBASE_PROJECT_ID')!==project||value(env,'MEMS_FIREBASE_PROJECT_ID')!==project)
    throw Error('Browser and server Firebase projects must equal the production GCP project');
  const auth=value(env,'VITE_FIREBASE_AUTH_DOMAIN');
  if(auth!==project+'.firebaseapp.com'&&auth!==project+'.web.app')throw Error('Firebase auth domain does not match production project');
  const region=value(env,'GCP_PROD_REGION');
  if(!/^[a-z]+(?:-[a-z]+\d+)+$/.test(region))throw Error('Invalid production region');
  for(const key of ['GCP_PROD_DEPLOYER_SA','GCP_PROD_RUNTIME_SA'])
    if(!value(env,key).endsWith('@'+project+'.iam.gserviceaccount.com'))throw Error(key+' does not belong to production');
  const wif=value(env,'GCP_PROD_WIF_PROVIDER');
  if(!/^projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/.test(wif))
    throw Error('Invalid production workload identity provider');
  const bucket=value(env,'MEMS_STORAGE_BUCKET');
  if(!bucket.startsWith(project+'-')&&!bucket.startsWith(project+'.'))throw Error('Production storage bucket must belong to production project');
  for(const key of ['VITE_FIREBASE_API_KEY','VITE_FIREBASE_APP_ID','VITE_FIREBASE_MESSAGING_SENDER_ID','VITE_FIREBASE_STORAGE_BUCKET'])value(env,key);
  return project;
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{console.log('Production configuration verified for '+verifyProductionDeploy())}
  catch(e){console.error(e instanceof Error?e.message:'Invalid configuration');process.exitCode=1}
}
