import test from 'node:test';
import assert from 'node:assert/strict';
import { accountPresence } from '../src/view.mjs';
import { currentUserObservation } from '../server/service.mjs';

test('authenticated cloud presence overrides stale offline state for account status',()=>{
  const user={id:'usr_alt',state:'offline',location:'offline',status:'ask me',
    presence:{world:'wrld_actual',instance:'1~region(jp)'}};
  assert.deepEqual(accountPresence(currentUserObservation(user)),{kind:'askme',label:'忙碌'});
  for (const [status,kind] of [['active','online'],['join me','joinme'],['busy','busy']])
    assert.equal(accountPresence(currentUserObservation({...user,status})).kind,kind);
  for (const location of ['private','traveling','traveling:traveling'])
    assert.equal(accountPresence({...user,location}).kind,'askme');
});

test('offline cloud locations retain the offline indicator despite a saved Ask Me status',()=>{
  for (const location of ['offline','offline:offline',''])
    assert.deepEqual(accountPresence({state:'offline',status:'ask me',location}),{kind:'offline',label:'离线'});
  assert.deepEqual(accountPresence(null),{kind:'offline',label:'离线'});
});
