import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptsApiKey } from '../src/api-key';
function withEnv(values:Record<string,string|undefined>, check:()=>void) {
  const previous={BLINDSPOT_API_KEYS:process.env.BLINDSPOT_API_KEYS,FRONTEND_ORIGIN:process.env.FRONTEND_ORIGIN};
  for(const [key,value] of Object.entries(values)) {if(value===undefined) delete process.env[key]; else process.env[key]=value;}
  try {check();} finally {for(const [key,value] of Object.entries(previous)) {if(value===undefined) delete process.env[key]; else process.env[key]=value;}}
}
test('api key is optional until BLINDSPOT_API_KEYS is set',()=>{withEnv({BLINDSPOT_API_KEYS:''},()=>{assert.equal(acceptsApiKey({},false),true);});});
test('api key accepts a configured key and the web app origin',()=>{withEnv({BLINDSPOT_API_KEYS:'bs_one,bs_two',FRONTEND_ORIGIN:'http://localhost:4200'},()=>{
  assert.equal(acceptsApiKey({'x-api-key':'bs_two'},false),true);
  assert.equal(acceptsApiKey({origin:'http://localhost:4200'},false),true);
  assert.equal(acceptsApiKey({'sec-fetch-site':'same-origin',referer:'http://127.0.0.1:3000/'},false),true);
  assert.equal(acceptsApiKey({},false),false);
  assert.equal(acceptsApiKey({'x-api-key':'nope'},false),false);
  assert.equal(acceptsApiKey({'sec-fetch-site':'same-origin',referer:'http://127.0.0.1:3000/api/docs'},false),false);
  assert.equal(acceptsApiKey({},true),true);
});});
