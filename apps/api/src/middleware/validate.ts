import { NextFunction, Request, Response } from 'express';
import { ZodTypeAny } from 'zod';

type RequestEnvelope = {
  body?: unknown;
  query?: unknown;
  params?: unknown;
};

export const validateRequest =
  (schema: ZodTypeAny) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      res.status(400).json({ message: 'Validation failed', errors: result.error.flatten() });
      return;
    }

    const data = result.data as RequestEnvelope;
    req.body = (data.body ?? req.body) as Request['body'];
    req.query = (data.query ?? req.query) as Request['query'];
    req.params = (data.params ?? req.params) as Request['params'];
    next();
  };
