import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { globalErrorHandler } from './middleware/errorHandler.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';
import { initSocket } from './services/socket.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { tasksRouter } from './routes/tasks.js';
import { submissionsRouter } from './routes/submissions.js';
import { reputationRouter } from './routes/reputation.js';
import { storageRouter } from './routes/storage.js';
import { verificationRouter } from './routes/verification.js';
import { a2aRouter } from './routes/a2a.js';
import { a2aProtocolRouter } from './routes/a2aProtocol.js';
import { forensicsRouter } from './routes/forensics.js';
import { custodyRouter } from './routes/custody.js';
import { stakingRouter } from './routes/staking.js';
import { accountingRouter } from './routes/accounting.js';
import { agentsRouter } from './routes/agents.js';
import { registrationRouter } from './routes/registration.js';
import { validatorsRouter } from './routes/validators.js';
import { statsRouter } from './routes/stats.js';
import { getDb } from './services/database.js';

const app = express();

// Security
app.use(helmet());
app.use(cors({
  origin: config.nodeEnv === 'development'
    ? [...new Set([...config.corsOrigin, 'http://localhost:5173', 'http://localhost:5174'])] as string[]
    : [...config.corsOrigin] as string[],
  credentials: true,
}));
app.use(createRateLimiter());

// Body parsing
app.use(express.json({ limit: '15mb' }));

// Request logging
app.use(requestLogger);

// Routes
app.use('/health', healthRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1/submissions', submissionsRouter);
app.use('/api/v1/reputation', reputationRouter);
app.use('/api/v1/storage', storageRouter);
app.use('/api/v1/verification', verificationRouter);
app.use('/api/v1/a2a', a2aRouter);
app.use('/api/v1/forensics', forensicsRouter);
app.use('/api/v1/custody', custodyRouter);
app.use('/api/v1/staking', stakingRouter);
app.use('/api/v1/accounting', accountingRouter);
app.use('/api/v1/agents', agentsRouter);
app.use('/api/v1/registration', registrationRouter);
app.use('/api/v1/validators', validatorsRouter);
app.use('/api/v1/stats', statsRouter);
app.use('/a2a/v1', a2aProtocolRouter);

// Agent card (A2A discovery)
app.get('/.well-known/agent.json', (_req, res) => {
  res.json({
    name: 'BlindMarket',
    description: 'Privacy-preserving task marketplace with blind escrow on 0G Chain',
    url: config.corsOrigin || 'http://localhost:3001',
    version: '1.0.0',
    capabilities: {
      a2a: true,
      streaming: false,
      pushNotifications: false,
    },
    skills: [
      { id: 'task_execution', name: 'Task Execution', description: 'Accept and execute tasks for payment' },
      { id: 'blind_escrow', name: 'Blind Escrow', description: 'Privacy-preserving payment escrow' },
    ],
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    provider: { organization: 'BlindMarket', url: 'https://github.com/blindmarket' },
  });
});

// Error handling (must be last)
app.use(globalErrorHandler);

// Initialize SQLite database and run migrations
getDb();

const corsOptions = {
  origin: config.nodeEnv === 'development'
    ? [...new Set([...config.corsOrigin, 'http://localhost:5173', 'http://localhost:5174'])] as string[]
    : [...config.corsOrigin] as string[],
  credentials: true,
};

const httpServer = createServer(app);
initSocket(httpServer, corsOptions);

httpServer.listen(config.port, () => {
  console.log(`BlindMarket backend listening on port ${config.port} (${config.nodeEnv})`);
});

export default app;
