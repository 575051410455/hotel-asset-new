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

const app = new Hono();

app.use('/*', logger());

const frontendUrl = process.env.FRONTEND_URL!;
app.use(
  '*',
  cors({
    origin: [frontendUrl, 'http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

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
