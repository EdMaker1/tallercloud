import { Controller, Get } from '@nestjs/common';
import { Publico } from './acceso';

/** Comprobación de salud para la plataforma de despliegue: sin sesión y sin tocar datos. */
@Controller('health')
export class SaludController {
  @Publico()
  @Get()
  salud() {
    return { ok: true };
  }
}
