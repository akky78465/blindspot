import 'reflect-metadata';
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Module, Controller, Post, Body, UploadedFile, UseInterceptors, Get, Put, Param, Res, UseGuards } from '@nestjs/common';
import { FileInterceptor, NestExpressApplication } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiTags, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ClaudeClient } from './claude';
import { Response } from 'express';
import { exportWorkbook } from './export';
import { Sessions } from './sessions';
import { ApiKeyGuard, Public } from './api-key';
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
  @ApiOkResponse({schema:{type:'object',properties:{completed:{type:'number'},total:{type:'number'},current:{type:'string'},status:{type:'string'},error:{type:'string'},suggestions:{type:'array',items:{type:'object'}}}}})
  progress(@Param('id') id:string){const s=this.sessions.get(id);return {...s.progress,suggestions:s.suggestions};}
  @Post(':id/export') @sessionId
  @ApiOperation({summary:'Download the Excel workbook'})
  @ApiBody({schema:{type:'object',required:['selectedIds'],properties:{selectedIds:{type:'array',items:{type:'string'},example:['EC-001']}}}})
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOkResponse({description:'Excel workbook',schema:{type:'string',format:'binary'}})
  async download(@Param('id') id:string,@Body() body:unknown,@Res() res:Response){const book=await exportWorkbook(this.sessions.get(id),body);res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="maryada-edge-cases.xlsx"');await book.xlsx.write(res);res.end();}
  @Get('health') @Public()
  @ApiOperation({summary:'Health check'})
  @ApiOkResponse({schema:{type:'object',properties:{ok:{type:'boolean',example:true}}}})
  health(){return {ok:true};}
}
@Module({controllers:[SessionsController],providers:[ClaudeClient,Sessions,ApiKeyGuard]})
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
