import { Hono } from 'hono';
import { mkdir, writeFile } from 'node:fs/promises';
import { imageSize } from 'image-size';
import { authMiddleware, type AuthVariables } from '../middleware/auth';
import { buildUserContext, maxPerm } from '../lib/session';

export const uploadRoutes = new Hono<{ Variables: AuthVariables }>();

const UPLOAD_DIR = 'uploads';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' };

// POST /api/uploads — multipart image. Stores the file under backend/uploads,
// computes width/height/aspect server-side, returns the public URL. Floor-plan
// management is a `floors:crud` capability.
uploadRoutes.post('/', authMiddleware, async (c) => {
  const ctx = await buildUserContext(Number(c.get('userId')));
  if (maxPerm(ctx, 'floors') !== 'crud') return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.parseBody();
  const file = body['file'];
  if (!(file instanceof File)) return c.json({ error: 'No file uploaded (field "file")' }, 400);

  const ext = ALLOWED[file.type];
  if (!ext) return c.json({ error: 'Only PNG or JPG images are allowed' }, 415);
  if (file.size > MAX_BYTES) return c.json({ error: 'Image exceeds the 10 MB limit' }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  let dim: { width?: number; height?: number };
  try {
    dim = imageSize(bytes);
  } catch {
    return c.json({ error: 'Could not read image dimensions' }, 400);
  }
  if (!dim.width || !dim.height) return c.json({ error: 'Could not read image dimensions' }, 400);

  const id = `flr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const filename = `${id}.${ext}`;
  // Write the raw bytes (note: EXIF is preserved — stripping it would need an
  // image-processing lib like sharp).
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(`${UPLOAD_DIR}/${filename}`, bytes);

  return c.json({
    id,
    url: `/uploads/${filename}`,
    width: dim.width,
    height: dim.height,
    aspect: +(dim.height / dim.width).toFixed(6),
  });
});
