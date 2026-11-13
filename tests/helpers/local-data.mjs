import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {Storage} from '../../server/storage.mjs';
import {MonikaService} from '../../server/service.mjs';
import {createHttpServer} from '../../server/http.mjs';
import {MonikaRemoteData} from '../../src/remote-data.mjs';

// Exercise the same HTTP and on-disk data path used by the plugin.
export function localData(t,{path=mkdtempSync(join(tmpdir(),'monika-data-test-')),remove=true}={}) {
  const storage=new Storage(path),service=new MonikaService(storage);
  for(const id of ['usr_alt','usr_other','usr_main'])service.profiles[id]={user:{id,displayName:id}};
  service.primaryId='usr_main';
  const server=createHttpServer(service,{projectRoot:resolve('.')});server.listen(0,'127.0.0.1');
  const ready=once(server,'listening');
  const api=async(route,body,params)=>{
    await ready;
    const query=params?'?'+new URLSearchParams(params):'';
    const response=await fetch(`http://127.0.0.1:${server.address().port}${route}${query}`,{
      ...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    });
    const value=await response.json();
    if(!response.ok)throw new Error(value.error);
    return value;
  };
  let closed=false;
  const close=async()=>{
    if(closed)return;closed=true;await ready;await new Promise(resolve=>server.close(resolve));storage.close();
  };
  t.after(async()=>{
    await close();
    if(remove){const target=resolve(path);assert(target.startsWith(resolve(tmpdir())+'\\monika-data-test-') || target.startsWith(resolve(tmpdir())+'/monika-data-test-'));rmSync(target,{recursive:true,force:true});}
  });
  return {path,service,storage,api,close,data:new MonikaRemoteData(api)};
}
