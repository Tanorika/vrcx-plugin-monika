import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { VRChatClient } from '../server/vrchat.mjs';
import { currentUserObservation, instancePopulation } from '../server/service.mjs';
import { realLocation } from '../server/recorder.mjs';
import { accountKey } from '../server/storage.mjs';

// Read-only diagnostic: never persists refreshed cookies, starts recording or touches the primary client.
const options=new Map();
for(let i=2;i<process.argv.length;i+=2)options.set(process.argv[i],process.argv[i+1]);
let client;
try {
  const id=accountKey(options.get('--account'));
  let session;
  if(options.has('--service-port')) {
    const port=Number(options.get('--service-port'));
    if(!Number.isInteger(port) || port<1024 || port>65535)throw new Error('无效的本地服务端口');
    const response=await fetch(`http://127.0.0.1:${port}/credentials`,{redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('本地服务未提供已登录会话');
    session=await response.json();if(session.user?.id!==id)throw new Error('本地服务当前账号与所选账号不匹配');
  } else {
    const sessions=JSON.parse(await readFile(resolve(options.get('--data-dir') || 'data','sessions.json'),'utf8'));
    session=sessions[id];
  }
  if(!session?.cookies)throw new Error('未找到所选账号的已保存会话');
  client=new VRChatClient({cookies:session.cookies,proxy:options.get('--proxy') || ''});
  const user=await client.request('auth/user');
  if(user.id!==id || user.requiresTwoFactorAuth)throw new Error('所选账号会话身份不匹配或需要二步验证');
  const location=options.get('--location') || currentUserObservation(user).location;
  if(!realLocation(location)) {console.log(JSON.stringify({authenticated:true,activeInstance:false}));}
  else {
    const data=await client.instance(location),population=instancePopulation(data,location);
    console.log(JSON.stringify({authenticated:true,activeInstance:true,...population,
      fields:{userCount:typeof data.userCount,n_users:typeof data.n_users,capacity:typeof data.capacity}}));
  }
} catch(error) {
  console.error(JSON.stringify({ok:false,status:error.status || 0,message:error.status?'VRChat API 查询未成功':error.message}));
  process.exitCode=1;
} finally {client?.close();}
