import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Module, Controller, Post, Body, UploadedFile, UseInterceptors, Get, Put, Param, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClaudeClient } from './claude';
import { Response } from 'express';
import { exportWorkbook } from './export';
import { Sessions } from './sessions';
config({path:resolve(__dirname,'../.env')});
@Controller('api/sessions')
class SessionsController {
  constructor(private readonly sessions:Sessions) {}
  @Post('upload') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5*1024*1024}}))
  upload(@UploadedFile() file:Express.Multer.File|undefined,@Body() body:{text?:unknown}) {return this.sessions.upload(file,body?.text);}
  @Post(':id/feature-map') map(@Param('id') id:string){return this.sessions.mapFeatures(id);}
  @Put(':id/feature-map') update(@Param('id') id:string,@Body() body:unknown){return this.sessions.saveMap(id,body);}
  @Post(':id/edge-cases') edges(@Param('id') id:string){return this.sessions.edges(id);}
  @Get(':id/progress') progress(@Param('id') id:string){return this.sessions.get(id).progress;}
  @Post(':id/export') async download(@Param('id') id:string,@Body() body:unknown,@Res() res:Response){const book=await exportWorkbook(this.sessions.get(id),body);res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="maryada-edge-cases.xlsx"');await book.xlsx.write(res);res.end();}
  @Get('health') health(){return {ok:true};}
}
@Module({controllers:[SessionsController],providers:[ClaudeClient,Sessions]})
class AppModule {}
async function bootstrap(){const app=await NestFactory.create(AppModule);app.enableCors({origin:process.env.FRONTEND_ORIGIN || 'http://localhost:4200'});await app.listen(Number(process.env.PORT || 3000),'127.0.0.1');}
bootstrap();
