import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',timeout:60000,workers:1,use:{baseURL:'http://127.0.0.1:4207',headless:true,screenshot:'only-on-failure'},webServer:[
{command:'node e2e/claude-stub.cjs',port:3101,reuseExistingServer:false},
{command:'node backend/dist/main.js',port:3007,reuseExistingServer:false,env:{PORT:'3007',ANTHROPIC_API_KEY:'test-only-not-a-real-key',ANTHROPIC_BASE_URL:'http://127.0.0.1:3101'}},
{command:'npm start -w frontend -- --port 4207 --proxy-config ../e2e/proxy.json',port:4207,reuseExistingServer:false}
]});
