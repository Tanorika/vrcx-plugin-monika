import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { VRChatClient } from '../server/vrchat.mjs';
import { mergeCredential } from '../src/plugin.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const option=(key,fallback='')=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const accountId=option('--account-id');
if (!/^usr_[a-zA-Z0-9-]+$/.test(accountId)) throw new Error('Specify --account-id with the account to recover.');
const databasePath=resolve(option('--database',join(process.env.APPDATA || '', 'VRCX', 'VRCX.sqlite3')));
const sessions=JSON.parse(await readFile(resolve(option('--sessions',join(root,'data','sessions.json'))),'utf8'));
const stored=sessions[accountId];
if (!stored?.cookies || stored.user?.id!==accountId) throw new Error('No matching saved Monika session.');
const client=new VRChatClient({cookies:stored.cookies,proxy:option('--proxy')});
try {
  // Cookie-only verification: never send a password or alter VRCX's native CookieContainer.
  const user=await client.request('auth/user');
  if (user.requiresTwoFactorAuth?.length) {
    console.log(JSON.stringify({status:'requires-2fa',displayName:stored.user.displayName,methods:user.requiresTwoFactorAuth}));
    process.exitCode=2;
  } else if (user.id!==accountId) {
    console.log(JSON.stringify({status:'identity-mismatch'}));process.exitCode=3;
  } else if (!args.includes('--restore')) {
    console.log(JSON.stringify({status:'valid',accountId,displayName:user.displayName}));
  } else {
    const database=new DatabaseSync(databasePath);
    try {
      const primaryId=database.prepare('SELECT value FROM configs WHERE key=?').get('config:lastuserloggedin')?.value;
      if (primaryId===accountId) throw new Error('The target is the current VRCX primary account.');
      const backupFolder=join(root,'data','recovery-backups');
      await mkdir(backupFolder,{recursive:true});
      const stamp=new Date().toISOString().replaceAll(':','-');
      // Save the original credential config before a conditional update; no global database transaction.
      let restored=false,backupPath='';
      for(let attempt=0;attempt<5;attempt++) {
        const previous=database.prepare('SELECT value FROM configs WHERE key=?').get('config:savedcredentials')?.value ?? null;
        const credentials=JSON.parse(previous ?? '{}');
        if (!credentials || typeof credentials!=='object' || Array.isArray(credentials)) throw new Error('Invalid savedCredentials config.');
        if (credentials[accountId]?.user?.id && credentials[accountId].user.id!==accountId) throw new Error('Existing credential identity mismatch.');
        backupPath=join(backupFolder,`saved-credentials-${stamp}-${attempt}.json`);
        await writeFile(backupPath,JSON.stringify({databasePath,previous},null,2),{mode:0o600,flag:'wx'});
        credentials[accountId]=mergeCredential(credentials[accountId],{user:{...stored.user,id:user.id,displayName:user.displayName,username:user.username || stored.user.username},cookies:client.exportCookies()},user.username || stored.user.username);
        if (database.prepare('SELECT value FROM configs WHERE key=?').get('config:lastuserloggedin')?.value!==primaryId)
          throw new Error('VRCX switched primary accounts during recovery; retry when login is complete.');
        const updated=JSON.stringify(credentials);
        const row=previous===null
          ? database.prepare('INSERT OR IGNORE INTO configs (key,value) VALUES (?,?) RETURNING key').get('config:savedcredentials',updated)
          : database.prepare('UPDATE configs SET value=? WHERE key=? AND value=? RETURNING key').get(updated,'config:savedcredentials',previous);
        if (row) {restored=true;break;}
      }
      if (!restored) throw new Error('VRCX kept updating credentials; no recovery was applied.');
      const saved=JSON.parse(database.prepare('SELECT value FROM configs WHERE key=?').get('config:savedcredentials').value);
      if(saved[accountId]?.cookies!==client.exportCookies()) throw new Error('Credential recovery verification failed.');
      console.log(JSON.stringify({status:'restored',accountId,displayName:user.displayName,backupPath}));
    } finally {database.close();}
  }
} catch(error) {
  // Avoid printing upstream responses, credentials or cookie data.
  console.log(JSON.stringify({status:'failed',httpStatus:error.status || 0,message:error.message}));process.exitCode=1;
} finally {client.close();}
