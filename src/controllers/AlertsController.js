// AlertsController.js

import { Router } from 'express';
import { AlertsService } from '../services/AlertsService.js';

/**
 * AlertsController: Manages all API endpoints related to alerts.
 */
export class AlertsController {
    router;
    alertsService;

    constructor() {
        this.router = Router();
        this.alertsService = new AlertsService();
        this.initializeRoutes();
    }

    initializeRoutes() {
        // POST /api/alerts - Endpoint to insert a new alert
        this.router.post('/', this.recordAlert);
    }

    /**
     * Express handler to record a new alert based on the request body.
     * Expects: { subscription_id: number, content: object } // CHANGED
     */
    recordAlert = async (req, res, next) => {
        try {
            const payload = req.body;
            
            // CHANGED: Validation now checks for subscription_id and content
            if (!payload.subscription_id || !payload.content) {
                 return res.status(400).json({ error: 'Missing required fields: subscription_id or content.' });
            }

            const newAlert = await this.alertsService.recordNewAlert(payload);

            // CHANGED: Response body now uses subscription_id and content
            res.status(201).json({
                message: 'Alert successfully recorded.',
                alert: {
                    id: newAlert.id,
                    subscription_id: newAlert.subscriptionId, // CHANGED
                    content: newAlert.content,                 // CHANGED
                    alert_timestamp: newAlert.alertTimestamp
                }
            });

        } catch (error) {
            console.error('Error in recordAlert:', error);
            const errorMessage = (error).message;
            // Use 400 for bad data (missing fields, invalid FKs)
            res.status(400).json({ error: errorMessage });
        }
    };
}