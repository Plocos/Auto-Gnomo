import { AppError, summarizeIssues, toValidationIssues } from '@autonomous/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodIssue } from 'zod';

function isSqliteBusy(error: Error): boolean {
  return /SQLITE_BUSY|database is locked|locked|busy_timeout|SQLITE_LOCKED/i.test(
    error.message,
  );
}

/** Duck-typed: shared y api pueden resolver instancias distintas de zod. */
function isZodError(error: unknown): error is Error & { issues: ZodIssue[] } {
  return (
    error instanceof Error &&
    error.name === 'ZodError' &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

export function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const context = { requestId: request.id, method: request.method, url: request.url };

  if (error instanceof AppError) {
    const body = error.toJSON();
    void reply.status(error.statusCode).send({
      ...body,
      details: { ...body.details, ...context },
    });
    return;
  }

  if (isZodError(error)) {
    const issues = toValidationIssues(error.issues);
    void reply.status(400).send({
      code: 'VALIDATION_ERROR',
      message: `Datos no válidos: ${summarizeIssues(issues)}`,
      details: { issues, zodIssues: error.issues, ...context },
    });
    return;
  }

  if (isSqliteBusy(error)) {
    void reply.status(503).send({
      code: 'CONFLICT',
      message:
        'La base de datos está bloqueada (¿otra instancia abierta o sincronización de Drive?). Cierra Auto-Gnomo en otros sitios y reabre el perfil.',
      details: { cause: error.message, ...context },
    });
    return;
  }

  const statusCode =
    'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;

  if (statusCode >= 500) {
    request.log.error(error);
  }

  void reply.status(statusCode).send({
    code: statusCode === 400 ? 'VALIDATION_ERROR' : 'INTERNAL',
    message: error.message || 'Error interno del servidor',
    details: {
      ...('validation' in error ? { validation: (error as FastifyError).validation } : {}),
      ...(statusCode >= 500 ? { stack: error.stack } : {}),
      ...context,
    },
  });
}
