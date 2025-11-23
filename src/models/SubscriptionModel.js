// backend/src/models/SubscriptionModel.js

import { DBClient } from '../db/DBClient.js';

const db = DBClient.getInstance();

/**
 * SubscriptionModel: Manages user subscriptions to AOI alert channels
 */
export class SubscriptionModel {
    id = null;
    projectId = null;
    aoiId = null;
    channelId = null;
    userIds = [];
    alertDisseminationMode = ['notify'];
    auxData = null;
    status = 1; // 1: Active, 0: Inactive, 2: Deleted

    constructor(data) {
        this.id = data.id || null;
        this.projectId = data.project_id;
        this.aoiId = data.aoi_id;
        this.channelId = data.channel_id;
        this.userIds = data.user_ids || [];
        this.alertDisseminationMode = data.alert_dissemination_mode || ['notify'];
        this.auxData = data.auxdata || null;
        this.status = data.status ?? 1;
    }

    /**
     * Saves a new subscription
     * @param {object} client - PG client for transaction support
     * @returns {Promise<number>} subscription ID
     */
    async save(client) {
        const query = `
            INSERT INTO subscription
            (project_id, aoi_id, channel_id, user_ids, alert_dissemination_mode, auxdata, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id;
        `;
        const values = [
            this.projectId,
            this.aoiId,
            this.channelId,
            this.userIds,
            this.alertDisseminationMode,
            this.auxData,
            this.status
        ];

        const result = await client.query(query, values);
        this.id = result.rows[0].id;
        return this.id;
    }

    /**
     * Updates an existing subscription
     * @param {object} client - PG client for transaction support
     */
    async update(client) {
        const query = `
            UPDATE subscription
            SET user_ids = $1,
                alert_dissemination_mode = $2,
                auxdata = $3,
                status = $4,
                last_modified = NOW()
            WHERE id = $5
            RETURNING id;
        `;
        const values = [
            this.userIds,
            this.alertDisseminationMode,
            this.auxData,
            this.status,
            this.id
        ];

        await client.query(query, values);
    }

    /**
     * Soft deletes a subscription (sets status to 2)
     * @param {object} client
     * @param {number} subscriptionId
     */
    static async softDelete(client, subscriptionId) {
        const query = `
            UPDATE subscription
            SET status = 2, last_modified = NOW()
            WHERE id = $1;
        `;
        await client.query(query, [subscriptionId]);
    }

    /**
     * Fetches all subscriptions for a project
     * @param {number} projectId
     * @param {boolean} includeDeleted
     * @returns {Promise<SubscriptionModel[]>}
     */
    static async findByProjectId(projectId, includeDeleted = false) {
        const statusFilter = includeDeleted ? '' : 'AND status != 2';
        const query = `
            SELECT * FROM subscription
            WHERE project_id = $1 ${statusFilter}
            ORDER BY aoi_id, channel_id;
        `;
        const result = await db.query(query, [projectId]);
        return result.rows.map(row => new SubscriptionModel(row));
    }

    /**
     * Fetches subscriptions for a specific AOI with enriched data
     * @param {number} projectId
     * @param {number} aoiId
     * @returns {Promise<Object[]>}
     */
    static async findByAoiWithDetails(projectId, aoiId) {
        const query = `
            SELECT 
                s.*,
                acc.channel_name,
                acc.category,
                acc.script_name,
                aoi.name as aoi_name
            FROM subscription s
            JOIN alert_channel_catalogue acc ON s.channel_id = acc.id
            JOIN area_of_interest aoi ON s.project_id = aoi.project_id AND s.aoi_id = aoi.aoi_id
            WHERE s.project_id = $1 AND s.aoi_id = $2 AND s.status != 2
            ORDER BY acc.category, acc.channel_name;
        `;
        const result = await db.query(query, [projectId, aoiId]);
        return result.rows;
    }

    /**
     * Fetches all active subscriptions for a user across all projects
     * @param {string} userId
     * @returns {Promise<Object[]>}
     */
    static async findByUserId(userId) {
        const query = `
            SELECT 
                s.*,
                p.name as project_name,
                aoi.name as aoi_name,
                acc.channel_name,
                acc.category
            FROM subscription s
            JOIN project p ON s.project_id = p.id
            JOIN area_of_interest aoi ON s.project_id = aoi.project_id AND s.aoi_id = aoi.aoi_id
            JOIN alert_channel_catalogue acc ON s.channel_id = acc.id
            WHERE $1 = ANY(s.user_ids) AND s.status = 1
            ORDER BY p.name, aoi.name;
        `;
        const result = await db.query(query, [userId]);
        return result.rows;
    }
}
