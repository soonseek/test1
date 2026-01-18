import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import { getEventBus } from '@magic-wand/agent-framework';
import { getOrchestrator } from './orchestrator';
import projectRoutes from './routes/projects';
import uploadRoutes from './routes/upload';
import surveyRoutes from './routes/survey';
import surveyChatRoutes from './routes/survey-chat';
import magicRoutes from './routes/magic';
import issueRoutes from './routes/issues';
import projectsFromPromptRoutes from './routes/projects-from-prompt';
import * as path from 'path';

// Load environment variables from current working directory (project root when running pnpm api:dev)
const envPath = path.resolve(process.cwd(), '.env');
console.log('[API] Loading .env from:', envPath);
console.log('[API] process.cwd():', process.cwd());
console.log('[API] File exists:', require('fs').existsSync(envPath));

dotenv.config({ path: envPath });

// Debug: 환경변수 로드 확인
console.log('[API] AWS_REGION:', process.env.AWS_REGION || 'NOT SET');
console.log('[API] S3_BUCKET:', process.env.S3_BUCKET || 'NOT SET');
console.log('[API] AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID?.substring(0, 10) + '...' || 'NOT SET');
console.log('[API] UPSTAGE_API_KEY:', process.env.UPSTAGE_API_KEY?.substring(0, 10) + '...' || 'NOT SET');

const app = express();
const PORT = process.env.API_PORT || 4000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'MAGIC WAND API',
    version: '1.0.0',
  });
});

// Register routes
app.use('/api/projects', projectRoutes);
app.use('/api/projects', projectsFromPromptRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/survey', surveyRoutes);
app.use('/api/survey-chat', surveyChatRoutes);
app.use('/api/magic', magicRoutes);
app.use('/api/issues', issueRoutes);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
});

// Start server
const server = app.listen(PORT, async () => {
  console.log(`🚀 MAGIC WAND API server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);

  // Initialize Event Bus
  const eventBus = getEventBus();
  console.log('Event Bus connected:', eventBus.isConnectedToRedis());

  // Start Orchestrator regardless of Redis connection (in-memory mode works)
  console.log('[API] Starting orchestrator...');
  const orchestrator = getOrchestrator();
  await orchestrator.start();
  console.log('[API] Orchestrator started');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    eventBus.disconnect();
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    eventBus.disconnect();
    process.exit(0);
  });
});

export default app;
