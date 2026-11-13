export class MonikaRemoteData {
  constructor(api){this.api=api;}
  async read(id,kind){return (await this.api('/data',undefined,{accountId:id,kind})).value;}
  async write(id,kind,key,value){await this.api('/data',{accountId:id,kind,key,value});}
  async context(id){return this.api('/archive-context',undefined,{accountId:id});}
  async history(id,options){return this.api('/history',undefined,{accountId:id,...options});}
  async detail(id,visitId){return this.api(`/visits/${encodeURIComponent(visitId)}`,undefined,{accountId:id});}
  async export(id,options){return this.api('/export',undefined,{accountId:id,...options});}
  async stats(id){return this.api('/people-stats',undefined,{accountId:id});}
  async accounts(){return (await this.api('/status')).accounts;}
}
