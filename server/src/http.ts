import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = 'ERROR',
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, 'BAD_REQUEST', details);
export const unauthorized = (msg = 'Autenticação necessária.') => new HttpError(401, msg, 'UNAUTHORIZED');
export const forbidden = (msg = 'Você não tem permissão para esta operação.') => new HttpError(403, msg, 'FORBIDDEN');
export const notFound = (msg = 'Registro não encontrado.') => new HttpError(404, msg, 'NOT_FOUND');
export const conflict = (msg: string, code = 'CONFLICT', details?: unknown) => new HttpError(409, msg, code, details);

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export function paramId(req: FastifyRequest, name = 'id'): number {
  const raw = (req.params as Record<string, string>)[name];
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Parâmetro ${name} inválido.`);
  return n;
}

export function errorHandler(err: any, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof HttpError) {
    return reply.status(err.status).send({ error: err.message, code: err.code, details: err.details });
  }
  if (err instanceof ZodError) {
    return reply.status(400).send({
      error: 'Dados inválidos: ' + err.issues.map((i) => `${i.path.join('.') || 'campo'}: ${i.message}`).join('; '),
      code: 'VALIDATION',
      details: err.issues,
    });
  }
  // Violações do PostgreSQL
  if (err?.code === '23505') {
    return reply.status(409).send({ error: 'Registro duplicado: já existe um item com esses dados.', code: 'DUPLICATE' });
  }
  if (err?.code === '23503') {
    return reply.status(409).send({ error: 'Operação viola um vínculo existente (registro em uso ou referência inválida).', code: 'FK' });
  }
  if (err?.code === '23514' || err?.code === '22P02' || err?.code === '22007') {
    return reply.status(400).send({ error: 'Dados fora das regras permitidas.', code: 'CHECK' });
  }
  if (err?.statusCode && err.statusCode < 500) {
    return reply.status(err.statusCode).send({ error: err.message, code: err.code ?? 'ERROR' });
  }
  req.log.error(err);
  return reply.status(500).send({ error: 'Erro interno. Tente novamente.', code: 'INTERNAL' });
}
