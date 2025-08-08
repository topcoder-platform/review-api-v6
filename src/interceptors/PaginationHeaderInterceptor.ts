import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { Response } from "express";

@Injectable()
export class PaginationHeaderInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap((response) => {
        if (response?.metadata) {
          const { total, page, perPage, totalPages } = response.metadata;
          res.setHeader('X-Total-Count', total);
          res.setHeader('X-Page', page);
          res.setHeader('X-Per-Page', perPage);
          res.setHeader('X-Total-Pages', totalPages);
        }
      }),
    );
  }
}
