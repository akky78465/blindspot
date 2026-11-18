import './instrumentation';
import 'reflect-metadata';
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Module, Controller, Post, Body, UploadedFile, UseInterceptors, Get, Put, Param, Query, Res, UseGuards } from '@nestjs/common';
import { FileInterceptor, NestExpressApplication } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiTags, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { EDGE_GENERATOR, EDGE_JUDGE, EdgeRunner } from './agents/runner';
import { ClaudeClient } from './claude';
import { Response } from 'express';
import { exportFormat, exportWorkbook, renderGherkin, renderPlaywright } from './export';
import { OpenAiJudge } from './openai';
import { Sessions } from './sessions';
import { ApiKeyGuard, Public } from './api-key';
import { TestRailClient } from './testrail-api';
config({path:resolve(__dirname,'../.env')});
const sessionId=ApiParam({name:'id',description:'Session id returned by upload'});
const categories=['boundary','null_empty','format','length','special_chars','date_time','state_transition','permissions','concurrency','security','domain'];
const featureMapBody={schema:{type:'object',required:['features'],properties:{features:{type:'array',items:{type:'object',required:['id','name','description','fields','rules','flows','testCaseIds','coveredCategories','uncoveredCategories'],properties:{id:{type:'string'},name:{type:'string'},description:{type:'string'},fields:{type:'array',items:{type:'object',properties:{name:{type:'string'},inferredType:{type:'string'},inferredConstraints:{type:'array',items:{type:'string'}}}}},rules:{type:'array',items:{type:'string'}},flows:{type:'array',items:{type:'string'}},testCaseIds:{type:'array',items:{type:'string'}},coveredCategories:{type:'array',items:{type:'string',enum:categories}},uncoveredCategories:{type:'array',items:{type:'string',enum:categories}},selected:{type:'boolean'}}}}}}};
@ApiTags('sessions')
@UseGuards(ApiKeyGuard)
@Controller('api/sessions')
class SessionsController {
  constructor(private readonly sessions:Sessions) {}
  @Post('upload')
  @ApiOperation({summary:'Upload test cases',description:'Send a spreadsheet as multipart field file (max 5 MB), or JSON { "text": "..." }.'})
  @ApiConsumes('multipart/form-data','application/json')
  @ApiBody({schema:{type:'object',properties:{file:{type:'string',format:'binary',description:'Spreadsheet or text file, max 5 MB.'},text:{type:'string',description:'Pasted test cases. Used when no file is sent.'}}}})
  @ApiOkResponse({description:'Created session',schema:{type:'object',properties:{sessionId:{type:'string'},testCases:{type:'array',items:{type:'object'}}}}})
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5*1024*1024}}))
  upload(@UploadedFile() file:Express.Multer.File|undefined,@Body() body:{text?:unknown}) {return this.sessions.upload(file,body?.text);}
  @Post('testrail')
  @ApiOperation({summary:'Upload a TestRail export',description:'Send a TestRail XML, CSV, or XLSX export as multipart field file (max 5 MB).'})
  @ApiConsumes('multipart/form-data')
  @ApiBody({schema:{type:'object',properties:{file:{type:'string',format:'binary',description:'TestRail export, max 5 MB.'}}}})
  @ApiOkResponse({description:'Created session',schema:{type:'object',properties:{sessionId:{type:'string'},testCases:{type:'array',items:{type:'object'}}}}})
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5*1024*1024}}))
  testrail(@UploadedFile() file:Express.Multer.File|undefined) {return this.sessions.uploadTestRail(file);}
  @Post(':id/feature-map') @sessionId
  @ApiOperation({summary:'Build the feature map'})
  @ApiOkResponse({description:'Inferred feature map',schema:featureMapBody.schema})
  map(@Param('id') id:string){return this.sessions.mapFeatures(id);}
  @Put(':id/feature-map') @sessionId
  @ApiOperation({summary:'Save an edited feature map'})
  @ApiBody(featureMapBody)
  @ApiOkResponse({description:'Saved feature map',schema:featureMapBody.schema})
  update(@Param('id') id:string,@Body() body:unknown){return this.sessions.saveMap(id,body);}
  @Post(':id/edge-cases') @sessionId
  @ApiOperation({summary:'Start edge-case generation'})
  @ApiOkResponse({schema:{type:'object',properties:{started:{type:'boolean'}}}})
  edges(@Param('id') id:string){return this.sessions.beginEdges(id);}
  @Get(':id/progress') @sessionId
  @ApiOperation({summary:'Read generation progress'})
  @ApiOkResponse({schema:{type:'object',properties:{completed:{type:'number'},total:{type:'number'},current:{type:'string'},status:{type:'string'},error:{type:'string'},review:{type:'string'},suggestions:{type:'array',items:{type:'object'}}}}})
  progress(@Param('id') id:string){const s=this.sessions.get(id);return {...s.progress,suggestions:s.suggestions};}
  @Post(':id/export') @sessionId
  @ApiOperation({summary:'Download selected cases as Excel, Gherkin, or Playwright'})
  @ApiBody({schema:{type:'object',required:['selectedIds'],properties:{selectedIds:{type:'array',items:{type:'string'},example:['EC-001']},format:{type:'string',enum:['xlsx','gherkin','playwright'],default:'xlsx',description:'Defaults to xlsx when omitted.'}}}})
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain')
  @ApiOkResponse({description:'Excel workbook (.xlsx), Gherkin feature (.feature), or Playwright skeleton (.spec.ts)',schema:{type:'string',format:'binary'}})
  async download(@Param('id') id:string,@Body() body:unknown,@Res() res:Response){
    const session=this.sessions.get(id);
    const format=exportFormat(body);
    if(format==='gherkin' || format==='playwright'){
      const filename=format==='gherkin'?'maryada-edge-cases.feature':'maryada-edge-cases.spec.ts';
      res.setHeader('Content-Type','text/plain; charset=utf-8');
      res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
      res.send(format==='gherkin'?renderGherkin(session,body):renderPlaywright(session,body));
      return;
    }
    const book=await exportWorkbook(session,body);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="maryada-edge-cases.xlsx"');
    await book.xlsx.write(res);res.end();
  }
  @Get('health') @Public()
  @ApiOperation({summary:'Health check'})
  @ApiOkResponse({schema:{type:'object',properties:{ok:{type:'boolean',example:true}}}})
  health(){return {ok:true};}
}
@Controller('api/testrail')
class TestRailController {
  constructor(private readonly testrail:TestRailClient, private readonly sessions:Sessions) {}
  @Get('projects') projects(){return this.testrail.projects();}
  @Get('projects/:projectId/suites') suites(@Param('projectId') projectId:string){return this.testrail.suites(Number(projectId));}
  @Get('projects/:projectId/cases') cases(@Param('projectId') projectId:string,@Query('suiteId') suiteId?:string,@Query('sectionId') sectionId?:string){return this.testrail.catalog(Number(projectId), suiteId ? Number(suiteId) : undefined, sectionId ? Number(sectionId) : undefined);}
  @Post('import') importCases(@Body() body:unknown){return this.sessions.importTestRail(body);}
}
@Module({controllers:[SessionsController,TestRailController],providers:[ClaudeClient,OpenAiJudge,{provide:EDGE_GENERATOR,useExisting:ClaudeClient},{provide:EDGE_JUDGE,useExisting:OpenAiJudge},EdgeRunner,Sessions,ApiKeyGuard,TestRailClient]})
class AppModule {}
async function bootstrap(){
  const app=await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({origin:process.env.FRONTEND_ORIGIN || 'http://localhost:4200'});
  const webRoot=process.env.WEB_ROOT || join(__dirname,'../../frontend/dist/maryada/browser');
  const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Blindspot').setDescription('Upload test cases, review the feature map, generate edge cases, and download an Excel workbook. Direct calls and Swagger Try it out send the x-api-key header. The web app on FRONTEND_ORIGIN does not.').setVersion('1.0').addApiKey({type:'apiKey',name:'x-api-key',in:'header',description:'Value from BLINDSPOT_API_KEYS.'},'apiKey').addSecurityRequirements('apiKey').build());
  const health=document.paths['/api/sessions/health']?.get; if(health) health.security=[];
  SwaggerModule.setup('api/docs',app,document,{jsonDocumentUrl:'api/openapi.json',customSiteTitle:'Blindspot API'});
  if(existsSync(webRoot)) app.useStaticAssets(webRoot);
  await app.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0');
}
bootstrap();
