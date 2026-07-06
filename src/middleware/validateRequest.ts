import { NextFunction, Request, Response } from 'express';
import { ZodType } from 'zod';

type RequestSchemas = {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
};

export const validateRequest = (schemas: RequestSchemas) => (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Route işleyicileri yalnızca doğrulanmış ve normalize edilmiş veri görür.
  for (const location of ['body', 'params', 'query'] as const) {
    const schema = schemas[location];
    if (!schema) continue;

    const result = schema.safeParse(req[location]);
    if (!result.success) {
      return res.status(400).json({
        error: 'İstek verileri geçersiz.',
        details: result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      });
    }

    if (location === 'body') req.body = result.data;
  }

  next();
};
