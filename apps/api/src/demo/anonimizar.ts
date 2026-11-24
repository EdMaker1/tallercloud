// Anonimización de los datos de demostración: reemplazo determinista de los clientes reales por clientes ficticios.
// La clave de la transformación sale del entorno (DEMO_CLAVE_ANONIMIZACION) y nunca se guarda en el repositorio.
import { createHmac } from 'node:crypto';

export interface Originales { documentos: Set<string>; telefonos: Set<string>; correos: Set<string> }

const NOMBRES = ['CARLOS', 'LUIS', 'JORGE', 'PEDRO', 'MIGUEL', 'JOSE', 'ANDRES', 'DIEGO', 'RAUL', 'VICTOR', 'MARIO', 'HUGO', 'OSCAR', 'FELIX', 'IVAN', 'SERGIO', 'MARIA', 'ROSA', 'ANA', 'LUCIA', 'CARMEN', 'ELENA', 'SOFIA', 'PAOLA', 'CLAUDIA', 'DIANA', 'PATRICIA', 'GLORIA', 'LAURA', 'SILVIA', 'TERESA', 'JULIA', 'ADRIAN', 'BRUNO', 'CESAR', 'DANIEL', 'ERICK', 'FABIAN', 'GONZALO', 'HECTOR'];
const APELLIDOS = ['QUISPE', 'HUAMAN', 'FLORES', 'MAMANI', 'CONDORI', 'CHAVEZ', 'RAMOS', 'TORRES', 'VARGAS', 'CASTRO', 'MENDOZA', 'ROJAS', 'DIAZ', 'GUTIERREZ', 'SALAZAR', 'PAREDES', 'CARDENAS', 'VALDIVIA', 'ZEGARRA', 'BEDOYA', 'ALVAREZ', 'MEDINA', 'CORNEJO', 'DELGADO', 'PINTO', 'SOTO', 'LEON', 'NINA', 'COLQUE', 'APAZA', 'CALLA', 'TICONA', 'PACHECO', 'ARIAS', 'BENAVIDES', 'CACERES', 'DUEÑAS', 'ESPINOZA', 'FUENTES', 'GALLEGOS'];
const PALABRAS = ['ANDINA', 'SUR', 'NORTE', 'PACIFICO', 'ALTIPLANO', 'VOLCAN', 'MISTI', 'CONDOR', 'PUMA', 'INTI', 'KURI', 'LLAMA', 'TAMBO', 'CHASQUI', 'ARENAS', 'COLCA', 'SILLAR', 'CAMPIÑA', 'MOLINO', 'PUENTE'];

const sinDigitos = (t: string) => t.replace(/\D/g, '');
/** Teléfono peruano de 9 dígitos que empieza con 9, con o sin prefijo +51 y con espacios o guiones. */
export const esTelefono = (t: string) => /^(51)?9\d{8}$/.test(sinDigitos(t));

const RE_CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Un teléfono o documento es una palabra aparte: no cuenta un tramo de uuid, de hash o de número de serie (EP912345678).
const RE_TELEFONO = /(?<![\w.+-])(?:\+?51[ -]?)?9\d{2}[ -]?\d{3}[ -]?\d{3}(?![\w.-])/g;
const RE_DIGITOS = /(?<![\w.-])\d{8,11}(?![\w.-])/g;

/** Categorías de datos personales que quedan en un texto: «telefono», «correo» o «documento» (de los datos originales). */
export function datosPersonalesEn(texto: string, originales: Originales, permitidos: Set<string> = new Set()): string[] {
  const hallados = new Set<string>();
  for (const t of texto.match(RE_TELEFONO) ?? []) if (!permitidos.has(sinDigitos(t).replace(/^51(?=9\d{8}$)/, ''))) hallados.add('telefono');
  // Los usuarios de la demostración llevan un correo ficticio con este dominio (no resuelve a nadie).
  for (const c of texto.match(RE_CORREO) ?? []) if (!permitidos.has(c.toLowerCase()) && !c.toLowerCase().endsWith('@demo.invalid')) hallados.add('correo');
  for (const d of texto.match(RE_DIGITOS) ?? []) {
    if (permitidos.has(d)) continue;
    if (originales.documentos.has(d)) hallados.add('documento');
    if (originales.telefonos.has(d)) hallados.add('telefono');
  }
  return [...hallados].sort();
}

export class Anonimizador {
  private cache = new Map<string, string>();
  private usados = new Set<string>();

  constructor(private clave: string, private originales: Originales) {
    if (clave.length < 16) throw new Error('La clave de anonimización debe tener al menos 16 caracteres.');
  }

  private hash(...partes: (string | number)[]) {
    return createHmac('sha256', this.clave).update(partes.join('|')).digest('hex');
  }
  private entero(hex: string, digitos: number) {
    const base = 10n ** BigInt(digitos - 1);
    return (BigInt(`0x${hex}`) % (base * 9n) + base).toString();
  }
  private elegir<T>(lista: T[], hex: string, desde: number) {
    return lista[Number(BigInt(`0x${hex.slice(desde, desde + 8)}`) % BigInt(lista.length))];
  }

  /** Documento inventado con el mismo tipo y formato; distinto de los originales y único entre clientes. Los genéricos («0000») no cambian. */
  documento(tipo: string, real: string): string {
    const clave = `doc|${tipo}|${real}`;
    const previo = this.cache.get(clave);
    if (previo) return previo;
    if (/^0+$/.test(real) || real.length < 5) return real;
    const prefijo = tipo === 'RUC' && /^(10|20)/.test(real) ? real.slice(0, 2) : '';
    for (let i = 0; ; i++) {
      const candidato = prefijo + this.entero(this.hash(clave, i), real.length - prefijo.length);
      if (this.originales.documentos.has(candidato) || this.usados.has(`${tipo}|${candidato}`)) continue;
      this.usados.add(`${tipo}|${candidato}`);
      this.cache.set(clave, candidato);
      return candidato;
    }
  }

  /** Nombre de persona ficticio, en mayúsculas como en el padrón. */
  nombre(real: string): string {
    const clave = `nom|${real}`;
    const previo = this.cache.get(clave);
    if (previo) return previo;
    for (let i = 0; ; i++) {
      const h = this.hash(clave, i);
      const n = `${this.elegir(APELLIDOS, h, 0)} ${this.elegir(APELLIDOS, h, 8)} ${this.elegir(NOMBRES, h, 16)}`;
      if (n !== real) { this.cache.set(clave, n); return n; }
    }
  }

  /** Razón social ficticia. */
  empresa(real: string): string {
    const clave = `emp|${real}`;
    const previo = this.cache.get(clave);
    if (previo) return previo;
    const h = this.hash(clave, 0);
    const n = `${this.elegir(PALABRAS, h, 0)} ${this.elegir(PALABRAS, h, 8)} S.A.C.`;
    this.cache.set(clave, n);
    return n;
  }
}
