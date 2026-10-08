import {
  Controller,
  Get,
  Headers,
  Header,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AppLogger } from '../common/app-logger.js';

/**
 * Support-facing diagnostics: environment summary plus a downloadable log
 * bundle.
 *
 * The summary reports *whether* configuration is present, never the value, so
 * it is safe to show. When `DIAGNOSTICS_TOKEN` is set, both routes require it
 * via the `x-diagnostics-token` header. Without a token the endpoints are open,
 * which is only acceptable on a developer machine — `warnMissingToken` makes
 * that explicit at boot.
 */
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private readonly logger: AppLogger) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  summary(@Headers('x-diagnostics-token') token?: string) {
    this.assertAuthorized(token);
    return {
      service: 'mangopos-api',
      env: process.env.NODE_ENV ?? 'development',
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      uptimeSeconds: Math.round(process.uptime()),
      pid: process.pid,
      configured: {
        database: Boolean(process.env.DATABASE_URL),
        supabaseUrl: Boolean(process.env.SUPABASE_URL),
        supabaseServiceKey: Boolean(process.env.SUPABASE_SERVICE_KEY),
        logLevel: process.env.LOG_LEVEL ?? 'log',
      },
      logBufferSize: this.logger.bufferCapacity,
      logsRetained: this.logger.count(),
      diagnosticsTokenRequired: Boolean(process.env.DIAGNOSTICS_TOKEN),
    };
  }

  @Get('logs')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  exportLogs(
    @Headers('x-diagnostics-token') token: string | undefined,
    @Query('limit') limit: string | undefined,
    @Res() res: Response,
  ): void {
    this.assertAuthorized(token);
    const requested = Number(limit ?? 500);
    const capped = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), this.logger.bufferCapacity)
      : this.logger.bufferCapacity;

    const header = [
      '# MangoPOS diagnostic log bundle',
      `generated:  ${new Date().toISOString()}`,
      `env:        ${process.env.NODE_ENV ?? 'development'}`,
      `node:       ${process.version}`,
      `platform:   ${process.platform} ${process.arch}`,
      `pid:        ${process.pid}`,
      `uptime_s:   ${Math.round(process.uptime())}`,
      '',
    ].join('\n');

    const body = this.logger
      .recent(capped)
      .map((record) => JSON.stringify(record))
      .join('\n');

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="mangopos-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.log"`,
    );
    res.send(`${header}\n${body}\n`);
  }

  /**
   * Called at boot. An open diagnostics surface in production is a real leak,
   * so make it loud rather than silent.
   */
  warnMissingToken(): void {
    if (!process.env.DIAGNOSTICS_TOKEN && process.env.NODE_ENV === 'production') {
      this.logger.write(
        'warn',
        'diagnostics_token_missing',
        { hint: 'set DIAGNOSTICS_TOKEN before exposing /diagnostics in production' },
      );
    }
  }

  private assertAuthorized(token: string | undefined): void {
    const expected = process.env.DIAGNOSTICS_TOKEN;
    if (!expected) return; // open by design on developer machines
    const provided = Buffer.from(token ?? '', 'utf8');
    const want = Buffer.from(expected, 'utf8');
    if (provided.length !== want.length || !timingSafeEqual(provided, want)) {
      throw new UnauthorizedException('invalid diagnostics token');
    }
  }
}
