import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { authRouter } from './routes/auth.routes.js';
import { deferredRouter } from './routes/deferred.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { shiftsRouter } from './routes/shifts.routes.js';
import { notificationRouter } from './routes/notification.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

export const createApp = () => {
  const app = express();

  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/shifts', shiftsRouter);
  app.use('/notifications', notificationRouter);
  app.use(deferredRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
