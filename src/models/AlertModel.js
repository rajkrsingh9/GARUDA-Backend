// AlertModel.js

import { DBClient } from '../db/DBClient.js';

const db = DBClient.getInstance();

/**
 * AlertModel: Handles persistence and retrieval logic for the 'alerts' table.
 * Now links directly to subscription via subscription_id.
 */
export class AlertModel {
    id = null;
    content = {}; // CHANGED: Renamed from 'message' to 'content'
    alertTimestamp = null;
    subscriptionId = null; // CHANGED: Renamed from 'mappingId' to 'subscriptionId', FK to subscription.id

    /**
     * Initializes a new AlertModel instance.
     * @param {object} data - Data to initialize the model.
     */
    constructor(data) {
    this.id = data.id || null;
    this.content = data.content || {};
    this.alertTimestamp = data.alert_timestamp || null;
    this.subscriptionId = data.subscription_id || null;
    this.auxData = data.auxdata || null; // ADD THIS
}

    /**
     * Records a new alert in the database.
     * @returns {Promise<number>} The ID of the newly created alert.
     */
    async save() {
        if (!this.subscriptionId || !this.content) {
            throw new Error("Alert must reference a Subscription ID and contain content.");
        }

        const query = `
    INSERT INTO alerts 
    (subscription_id, content, alert_timestamp, auxdata) 
    VALUES ($1, $2, NOW(), $3)
    RETURNING id, alert_timestamp;
`;
const values = [
    this.subscriptionId,
    this.content,
    this.auxData || null  // ADD THIS
];

        
        const result = await db.query(query, values);
        this.id = result.rows[0].id;
        this.alertTimestamp = result.rows[0].alert_timestamp;
        return this.id;
    }

    /**
     * Counts the total number of alerts for a given user across all their projects.
     * Requires joining users_to_project -> project -> subscription -> alerts.
     * @param {string} userId - The ID of the user.
     * @returns {Promise<number>} The total count of alerts.
     */
    static async countAlertsByUserId(userId) {
        // CHANGED: Join path updated to alerts -> subscription -> area_of_interest -> users_to_project
        const query = `
            SELECT COUNT(a.id)
            FROM alerts a
            JOIN subscription s ON a.subscription_id = s.id
            JOIN users_to_project up ON s.project_id = up.project_id
            WHERE up.user_id = $1;
        `;
        const result = await db.query(query, [userId]);
        
        return parseInt(result.rows[0].count, 10);
    }
}