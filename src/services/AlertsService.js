// AlertsService.js

import { AlertModel } from '../models/AlertModel.js';



function normalizeFeatureGeoJson(input) {
    if (!input) return null;

    // Already a Feature
    if (input.type === "Feature") return input;

    // If raw geometry → wrap as Feature
    if (input.type && input.coordinates) {
        return {
            type: "Feature",
            geometry: input,
            properties: {}
        };
    }

    // If FeatureCollection → keep as is
    return input;
}


/**
 * Defines the simplified payload structure from the API now using subscription_id.
 * @typedef {object} NewAlertPayload
 * @property {number} subscription_id - FK to subscription.id
 * @property {object} content - The alert content JSONB.
 * @property {object} [feature_geojson] - Optional GeoJSON for the feature related to the alert. // NEW
 */


/**
 * AlertsService: Manages business logic related to alerts.
 */
export class AlertsService {

    /**
     * Records a new alert using the data provided in the API request body.
     * @param {object} payload - The alert data from the incoming API request.
     * @returns {Promise<AlertModel>} The newly created AlertModel instance.
     */
    async recordNewAlert(payload) {

        // Input validation (basic check)
        if (!payload.subscription_id || !payload.content) {
            throw new Error("Missing required fields for alert: subscription_id or content.");
        }

        // Create an instance of the model
        const newAlert = new AlertModel({
            subscription_id: payload.subscription_id,
            content: payload.content,
            feature_geojson: normalizeFeatureGeoJson(payload.feature_geojson),

        });

        // Save the alert to the database
        await newAlert.save();

        // Return the complete model instance with the generated ID and timestamp
        return newAlert;
    }
}