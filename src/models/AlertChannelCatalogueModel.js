// backend/src/models/AlertChannelCatalogueModel.js

import { DBClient } from '../db/DBClient.js';

const db = DBClient.getInstance();

/**
 * AlertChannelCatalogueModel: Handles predefined alert channels
 */
export class AlertChannelCatalogueModel {
    id = null;
    scriptId = null;
    scriptName = null;
    channelName = null;
    category = null;
    args = null;
    auxData = null;

    constructor(data) {
        this.id = data.id || null;
        this.scriptId = data.script_id;
        this.scriptName = data.script_name;
        this.channelName = data.channel_name;
        this.category = data.category;
        this.args = data.args || null;
        this.auxData = data.auxdata || null;
    }

    /**
     * Fetches all active alert channels
     * @returns {Promise<AlertChannelCatalogueModel[]>}
     */
    static async findAll() {
        const query = `
            SELECT id, script_id, script_name, channel_name, category, args, auxdata
            FROM alert_channel_catalogue
            ORDER BY category, channel_name;
        `;
        const result = await db.query(query);
        return result.rows.map(row => new AlertChannelCatalogueModel(row));
    }

    /**
     * Fetches a single channel by ID
     * @param {number} id
     * @returns {Promise<AlertChannelCatalogueModel|null>}
     */
    static async findById(id) {
        const query = `
            SELECT * FROM alert_channel_catalogue WHERE id = $1;
        `;
        const result = await db.query(query, [id]);
        if (result.rows.length === 0) return null;
        return new AlertChannelCatalogueModel(result.rows[0]);
    }

    /**
     * Fetches channels by category
     * @param {string} category
     * @returns {Promise<AlertChannelCatalogueModel[]>}
     */
    static async findByCategory(category) {
        const query = `
            SELECT * FROM alert_channel_catalogue 
            WHERE category = $1
            ORDER BY channel_name;
        `;
        const result = await db.query(query, [category]);
        return result.rows.map(row => new AlertChannelCatalogueModel(row));
    }
}