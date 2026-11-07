import type { FastifyInstance } from 'fastify';
import { requireUser } from './auth';
import { getUsage } from './quota';

export function registerUsageRoutes(app: FastifyInstance): void {
  app.get('/api/usage', { preHandler: app.authenticate }, async (request) => {
    const user = await requireUser(app, request);
    return getUsage(app.db, user, app.config, app.now());
  });
}
