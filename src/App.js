// App.js
import express from 'express';
import * as dotenv from 'dotenv';
import cors from 'cors';

import { AuthController } from './controllers/AuthController.js';
import { ProjectController } from './controllers/ProjectController.js';

import { AlertsController } from './controllers/AlertsController.js';
import { initAlertsSSE } from './services/AlertsSSEService.js'; // <<< Updated import

/**
 * App Class: The primary object-oriented wrapper for the Express server.
 * Initializes all controllers and middleware.
 */
export class App {
    app;
    port;

    constructor() {
        dotenv.config();
        this.app = express();
        this.port = parseInt(process.env.PORT || '3000');
        
        this.initializeMiddleware();
        this.initializeControllers();
    }

    initializeMiddleware() {
        this.app.use(cors());
        this.app.use(express.json());
        // Basic check to ensure user ID is present for authorized routes (mock check)
        this.app.use('/api', (req, res, next) => {
             if (req.url !== '/auth/login' && !req.header('X-User-ID')) {
                 // Simulate user authentication by checking a header after login
                 // In a real app, this would be a JWT middleware check
             }
             next();
        });
    }

    initializeControllers() {
        this.app.get('/api/status', (req, res) => {
            res.json({ message: 'Garuda V1 API is online.' });
        });
        
        // Register Controllers as the official API endpoints
        this.app.use('/api/auth', new AuthController().router);
        this.app.use('/api/projects', new ProjectController().router);
        this.app.use('/api/alerts', new AlertsController().router);

        initAlertsSSE(this.app);
    }

    start() {
        this.app.listen(this.port, () => {
            console.log(`⚡️ Garuda V1 Server running on http://localhost:${this.port}`);
        });
    }
}
