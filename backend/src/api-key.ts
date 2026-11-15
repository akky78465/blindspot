import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
function header(value:string|string[]|undefined) {return Array.isArray(value) ? value[0] : value;}
export function acceptsApiKey(headers:Record<string,string|string[]|undefined>, publicRoute:boolean) {
  if(publicRoute) return true;
  const keys=(process.env.BLINDSPOT_API_KEYS || '').split(',').map(key=>key.trim()).filter(Boolean);
  if(!keys.length) return true;
  const provided=header(headers['x-api-key']);
  if(provided && keys.includes(provided)) return true;
  const origin=header(headers.origin);
  const allowed=(process.env.FRONTEND_ORIGIN || 'http://localhost:4200').split(',').map(item=>item.trim()).filter(Boolean);
  if(origin && allowed.includes(origin)) return true;
  const referer=header(headers.referer) || '';
  if(header(headers['sec-fetch-site'])==='same-origin' && !referer.includes('/api/docs')) return true;
  return false;
}
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly reflector:Reflector) {}
  canActivate(context:ExecutionContext) {
    const isPublic=this.reflector.getAllAndOverride<boolean>(IS_PUBLIC,[context.getHandler(),context.getClass()]);
    const req=context.switchToHttp().getRequest();
    if(acceptsApiKey(req.headers,!!isPublic)) return true;
    throw new UnauthorizedException('Missing or invalid x-api-key.');
  }
}
