import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { authRoutes } from './routes/auth';
import { hotelRoutes } from './routes/hotels';
import { floorRoutes } from './routes/floors';
import { deviceRoutes } from './routes/devices';
import { accessRoutes } from './routes/access';
import { uploadRoutes } from './routes/uploads';
import { sessionOrigin } from './lib/auth-session';

const app = new Hono();

app.use('/*', logger());

app.use(
  '*',
  cors({
    origin: sessionOrigin(),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-CSRF-Token'],
    credentials: true,
  })
);

// A state-changing API request must come from the application's own origin.
// Browsers always send Origin on these methods; a missing or foreign one is a
// cross-site request (or a non-browser client) and is refused before any route
// runs — including sign-in, so another site cannot log a visitor in or out.
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
app.use('/api/*', async (c, next) => {
  if (UNSAFE_METHODS.has(c.req.method) && c.req.header('origin') !== sessionOrigin()) {
    return c.json({ error: 'Invalid request origin' }, 403);
  }
  await next();
});

// Serve uploaded floor-plan images (backend/uploads/* → /uploads/*).
app.use('/uploads/*', serveStatic({ root: './' }));

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes
const apiRoutes = app
  .basePath('/api')
  .route('/auth', authRoutes)
  .route('/hotels', hotelRoutes)
  .route('/floors', floorRoutes)
  .route('/devices', deviceRoutes)
  .route('/access', accessRoutes)
  .route('/uploads', uploadRoutes);

app.notFound((c) => c.json({ error: 'Not Found' }, 404));
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
export type ApiRoutes = typeof apiRoutes;
