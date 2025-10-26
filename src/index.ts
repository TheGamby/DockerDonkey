import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import mime from 'mime-types';
import Docker from 'dockerode';
import { simpleGit } from 'simple-git';

const app = express();
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const STATIC_DIR = path.join(process.cwd(), 'public');
const UPLOAD_DIR = path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads');

// Global constant: upstream Git repository to use for status/pull
export const UPSTREAM_REPO = 'https://github.com/TheGamby/DockerDonkey.git';

// Ensure upload dir exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Middlewares
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',').map(s => s.trim()) || true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(STATIC_DIR));

// Multer config for uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Very basic sanitization: strip path separators
    const safe = file.originalname.replace(/[\\/]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024, files: 20 } // 100MB, up to 20 files
});

// Docker client
const docker = new Docker({ socketPath: process.env.DOCKER_SOCK || '/var/run/docker.sock' });

// Helpers
const asyncHandler = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);

// Routes: Files
app.post('/api/files/upload', upload.array('files'), asyncHandler(async (req, res) => {
  const files = (req.files as any[] | undefined) || [];
  const result = files.map(f => ({
    original: f.originalname,
    storedAs: path.basename(f.path),
    size: f.size,
    mime: mime.lookup(f.originalname) || 'application/octet-stream',
    path: `/uploads/${path.basename(f.path)}`
  }));
  return res.json({ ok: true, files: result });
}));

// Expose uploads statically (read-only)
app.use('/uploads', express.static(UPLOAD_DIR));

// Routes: Git
const git = simpleGit({ baseDir: process.cwd() });

async function ensureOriginRemote() {
  const remotes = await git.getRemotes(true);
  const origin = remotes.find(r => r.name === 'origin');
  if (!origin) {
    await git.addRemote('origin', UPSTREAM_REPO);
  } else {
    const currentUrl = origin.refs.fetch || origin.refs.push;
    if (currentUrl && currentUrl !== UPSTREAM_REPO) {
      await git.remote(['set-url', 'origin', UPSTREAM_REPO]);
    }
  }
}

app.get('/api/git/status', asyncHandler(async (_req, res) => {
  const isRepo = await git.checkIsRepo();
  if (!isRepo) return res.json({ ok: true, repo: false });

  // Ensure remote "origin" points to our upstream
  await ensureOriginRemote();

  // Fetch from origin
  await git.fetch('origin');
  const branch = await git.branch();
  const current = branch.current;
  const status = await git.status();
  const upstream = `origin/${current}`;
  let ahead = 0, behind = 0;
  try {
    const r = await git.raw(['rev-list', '--left-right', '--count', `${current}...${upstream}`]);
    const [a, b] = r.trim().split('\t').map(n => Number(n));
    ahead = a || 0; behind = b || 0;
  } catch (_) { /* ignore */ }
  res.json({ ok: true, repo: true, branch: current, upstream, ahead, behind, summary: status });
}));

app.post('/api/git/pull', asyncHandler(async (_req, res) => {
  const isRepo = await git.checkIsRepo();
  if (!isRepo) return res.status(400).json({ ok: false, error: 'Not a Git repository' });

  await ensureOriginRemote();
  await git.fetch('origin');
  const current = (await git.branch()).current;
  const result = await git.pull('origin', current);
  res.json({ ok: true, result });
}));

// Routes: Docker
app.get('/api/docker/containers', asyncHandler(async (req, res) => {
  const all = req.query.all === '1' || req.query.all === 'true';
  const containers = await docker.listContainers({ all });
  res.json({ ok: true, containers });
}));

app.get('/api/docker/images', asyncHandler(async (_req, res) => {
  const images = await docker.listImages();
  res.json({ ok: true, images });
}));

app.post('/api/docker/images/pull', asyncHandler(async (req, res) => {
  const { image } = req.body as { image: string };
  if (!image) return res.status(400).json({ ok: false, error: 'image is required, e.g. nginx:latest' });
  const [repo, tag = 'latest'] = image.split(':');
  await new Promise<void>((resolve, reject) => {
    docker.pull(`${repo}:${tag}`, (err, stream) => {
      if (err || !stream) return reject(err);
      docker.modem.followProgress(stream, (err2: any) => err2 ? reject(err2) : resolve());
    });
  });
  res.json({ ok: true });
}));

app.post('/api/docker/containers/:id/start', asyncHandler(async (req, res) => {
  const c = docker.getContainer(req.params.id);
  await c.start();
  res.json({ ok: true });
}));

app.post('/api/docker/containers/:id/stop', asyncHandler(async (req, res) => {
  const c = docker.getContainer(req.params.id);
  await c.stop();
  res.json({ ok: true });
}));

app.post('/api/docker/containers/:id/restart', asyncHandler(async (req, res) => {
  const c = docker.getContainer(req.params.id);
  await c.restart();
  res.json({ ok: true });
}));

app.delete('/api/docker/containers/:id', asyncHandler(async (req, res) => {
  const c = docker.getContainer(req.params.id);
  await c.remove({ force: true });
  res.json({ ok: true });
}));

app.get('/api/docker/containers/:id/logs', asyncHandler(async (req, res) => {
  const c = docker.getContainer(req.params.id);
  const logs = await c.logs({ stdout: true, stderr: true, tail: Number(req.query.tail || 200), timestamps: false });
  res.type('text/plain').send(logs.toString());
}));

app.post('/api/docker/containers/create', asyncHandler(async (req, res) => {
  const { image, name, cmd } = req.body as { image: string; name?: string; cmd?: string[] };
  if (!image) return res.status(400).json({ ok: false, error: 'image is required' });
  const container = await docker.createContainer({ Image: image, name, Cmd: cmd });
  await container.start();
  res.json({ ok: true, id: container.id });
}));

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Fallback to UI
app.get('*', (_req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// Error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err?.message || 'Internal Server Error' });
});

app.listen(PORT, HOST, () => {
  console.log(`DockerDonkey listening on http://${HOST}:${PORT}`);
});
