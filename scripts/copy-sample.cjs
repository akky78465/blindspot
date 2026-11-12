const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'frontend/public/samples'),{recursive:true});fs.copyFileSync(path.join(root,'samples/service-request-testcases.xlsx'),path.join(root,'frontend/public/samples/service-request-testcases.xlsx'));
