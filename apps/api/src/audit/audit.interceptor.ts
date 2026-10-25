import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tap } from 'rxjs';
import type { AuditEntry } from './audit-entry.js';
import { auditDetail } from './audit-detail.js';
import { AUDIT_KEY, type AuditRouteMetadata } from './audit.decorator.js';
import { decideAudit, entityIdFromParams, type AuditDecision } from './audit-policy.js';
import { AuditService } from './audit.service.js';

/** The parts of the Express request this interceptor reads. */
interface AuditRequest {
  method: string;
  path?: string;
  originalUrl?: string;
  ip?: string;
  body?: unknown;
  params?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
  requestId?: string;
  user?: { userId?: string; businessId?: string; appRole?: string };
}

const MAX_TEXT = 512;

function truncate(value: string | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) : value;
}

function headerValue(request: AuditRequest, name: string): string | null {
  const raw = request.headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return truncate(value);
}

function requestPath(request: AuditRequest): string {
  if (typeof request.path === 'string' && request.path.length > 0) return request.path;
  return (request.originalUrl ?? '/').split('?')[0];
}

function outcomeOf(status: number): 'success' | 'denied' | 'error' {
  if (status >= 500) return 'error';
  if (status >= 400) return 'denied';
  return 'success';
}

function statusOf(error: unknown): number {
  if (error && typeof error === 'object') {
    const candidate = error as { getStatus?: () => number; status?: number };
    if (typeof candidate.getStatus === 'function') {
      const status = candidate.getStatus();
      if (Number.isInteger(status)) return status;
    }
    if (Number.isInteger(candidate.status)) return candidate.status as number;
  }
  return 500;
}

/**
 * Records the API side of a sensitive operation, and the events no trigger can
 * see.
 *
 * It does not record routine writes: the `AFTER` trigger on each table already
 * writes the row-level entry with the real before and after values, and a second
 * entry for the same change would be noise. What the trigger cannot know is the
 * request around it - who called, from which address, with which reason, and
 * whether it succeeded. That is what lands here.
 *
 * Nothing from the request is copied wholesale. Headers are never recorded
 * except a truncated user agent, the body only through the scalar allowlist in
 * `auditDetail()`, and only for a sensitive operation. A password or a token
 * cannot reach the trail because it has no name on that list.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): ReturnType<CallHandler['handle']> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuditRequest>();
    const path = requestPath(request);
    const route = this.reflector.getAllAndOverride<AuditRouteMetadata | undefined>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const decision = decideAudit(request.method, path, route);

    // The trigger owns routine writes, and reads are never audited.
    if (!decision) return next.handle();

    const startedAt = process.hrtime.bigint();
    let recorded = false;

    const finish = (status: number): void => {
      // `tap` can fire more than once for a multi-emission handler; one request
      // is one entry.
      if (recorded) return;
      recorded = true;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      // Not awaited: the response must not wait on the trail. AuditService
      // swallows and logs a writer failure, so this promise cannot reject.
      void this.audit.record(this.buildEntry(request, decision, status, durationMs));
    };

    return next.handle().pipe(
      tap({
        next: () => finish(http.getResponse<{ statusCode?: number }>()?.statusCode ?? 200),
        error: (error: unknown) => finish(statusOf(error)),
      }),
    );
  }

  private buildEntry(
    request: AuditRequest,
    decision: AuditDecision,
    status: number,
    durationMs: number,
  ): AuditEntry {
    const user = request.user;
    const body = request.body;

    // Detail only for the three operations the plan calls out. A login body is
    // never read at all, which is the strongest form of "never log the password".
    const newValues = decision.sensitive ? auditDetail(body) : null;
    const oldValues = decision.sensitive
      ? auditDetail((body as { before?: unknown } | undefined)?.before)
      : null;

    return {
      businessId: typeof user?.businessId === 'string' ? user.businessId : null,
      userId: typeof user?.userId === 'string' ? user.userId : null,
      action: decision.action,
      entityType: decision.entityType,
      entityId: entityIdFromParams(request.params),
      oldValues,
      newValues,
      metadata: {
        operation: request.method.toUpperCase(),
        sensitive: decision.sensitive,
        request_id: request.requestId ?? null,
        method: request.method.toUpperCase(),
        path: truncate(requestPath(request)),
        status,
        duration_ms: Math.round(durationMs * 100) / 100,
        ip: truncate(request.ip),
        user_agent: headerValue(request, 'user-agent'),
        outcome: outcomeOf(status),
      },
    };
  }
}
