import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppLogger } from './app-logger.js';

/**
 * One structured line per completed HTTP request: method, path, status,
 * duration and a request id echoed back in `x-request-id` so a user-reported
 * failure can be traced through the logs.
 */
@Injectable()
export class RequestLogger implements NestMiddleware {
  constructor(private readonly logger: AppLogger) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = this.logger.newRequestId();
    res.setHeader('x-request-id', requestId);
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'log';
      this.logger.write(
        level,
        'http_request',
        {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        },
        undefined,
        // Without this the id we hand the client cannot be tied back to a line.
        requestId,
      );
    });

    next();
  }
}
