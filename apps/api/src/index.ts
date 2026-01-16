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
import magicRoutes from './routes/magic';
import issueRoutes from './routes/issues';

// Load environment variables
dotenv.config();

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
app.use('/api/upload', uploadRoutes);
app.use('/api/survey', surveyRoutes);
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
