import {expect,it} from 'vitest';
import express from 'express';
import {createServer} from 'node:http';
import {createManagerRouter} from '../src/managerRoutes.js';
import {createSessionToken} from '../src/session.js';
import {SESSION_COOKIE_NAME,SESSION_MAX_AGE_MS} from '../src/cookies.js';
it('returns a stable authenticated login boundary without disclosing the cookie',async()=>{
 const secret='test-session',app=express();
 app.use(createManagerRouter({sessionSecret:secret,baseUrl:null,serviceKey:null,userId:null}));
 const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const address=server.address();if(!address||typeof address==='string')throw Error('address');
  const url=`http://127.0.0.1:${address.port}/api/manager/chat-session`;
  expect((await fetch(url)).status).toBe(401);
  const token=createSessionToken(secret),headers={cookie:`${SESSION_COOKIE_NAME}=${token}`};
  const response=await fetch(url,{headers});expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body=await response.json();
  expect(body).toEqual({startedAt:new Date(Number(token.split('.')[0])-SESSION_MAX_AGE_MS).toISOString()});
  expect(await (await fetch(url,{headers})).json()).toEqual(body);
  expect((await fetch(url,{headers:{cookie:`${SESSION_COOKIE_NAME}=${token}invalid`}})).status).toBe(401);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
