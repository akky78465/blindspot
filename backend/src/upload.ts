import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { mask } from './privacy';
export function parseUpload(file?: Express.Multer.File, text?: unknown): unknown[][] {
  if (file && typeof text==='string' && text.trim()) throw new BadRequestException('Provide a file or pasted text, not both.');
  if (!file) {
    if (typeof text!=='string' || !text.trim()) throw new BadRequestException('Upload an Excel/CSV file or paste test cases.');
    if (text.length>100000) throw new BadRequestException('Pasted text is limited to 100,000 characters.');
    return [[{sourceRef:'Pasted text',text:mask(text)}]];
  }
  if (!/\.(xlsx|csv)$/i.test(file.originalname)) throw new BadRequestException('Only .xlsx and .csv files are supported.');
  try {
    const book = XLSX.read(file.buffer,{type:'buffer',cellDates:true});
    const rows: unknown[] = [];
    for (const name of book.SheetNames) {
      const sheet = book.Sheets[name];
      const values = XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:'',raw:false});
      for (const row of values) rows.push({sourceRef:`${name} row ${(row as {__rowNum__:number}).__rowNum__+1}`,row:JSON.parse(mask(JSON.stringify(row)))});
    }
    if (!rows.length || rows.length>600) throw new Error('Use between 1 and 600 data rows.');
    if (JSON.stringify(rows).length>500000) throw new Error('Workbook text exceeds 500,000 characters.');
    return Array.from({length:Math.ceil(rows.length/30)},(_,i)=>rows.slice(i*30,i*30+30));
  } catch (e) { throw new BadRequestException(e instanceof Error ? `Cannot read upload: ${e.message}` : 'Cannot read workbook.'); }
}
