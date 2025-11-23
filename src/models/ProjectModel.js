// ProjectModel.js

import { DBClient } from '../db/DBClient.js';
import { AreaOfInterestModel } from './AreaOfInterestModel.js';

const db = DBClient.getInstance();

/**
 * ProjectModel: Handles persistence logic for the 'project' table.
 */
export class ProjectModel {
    // Properties matching the database columns
    id = null;
    projectName = ''; // Use internal name that matches the frontend/service DTO
    description = null;
    createdByUserId = '';
    auxData = null;
    creationDate = null;
    lastModifiedDate = null; // RENAMED: from lastModifiedDate
    
    // Transient data for the 4-step process
    aois = [];

    /**
     * @param {object} data - Data to initialize the model.
     */
    constructor(data) {
        this.id = data.id || null;
        this.projectName = data.name || ''; // <-- Use 'name' from DB
        this.description = data.description || null;
        this.createdByUserId = data.created_by_userid || '';
        this.auxData = data.auxdata || null;
        this.creationDate = data.creation_timestamp || null;
        this.lastModifiedDate = data.last_modified_timestamp || null; // <-- Update to new column name
    }

    /**
     * Saves a new project to the database.
     * @param {string} userId
     * @returns {Promise<number>} The newly created project ID.
     */
    async save(userId) {
        const query = `
            INSERT INTO project
            (name, description, created_by_userid, auxdata)
            VALUES ($1, $2, $3, $4)
            RETURNING id, creation_timestamp;
        `;
        const values = [
            this.projectName,
            this.description,
            userId,
            this.auxData
        ];

        const result = await db.query(query, values);
        this.id = result.rows[0].id;
        this.creationDate = result.rows[0].creation_timestamp;
        return this.id;
    }


    /**
     * Updates an existing project's basic information.
     * Requires the transaction client for context.
     * @param {object} client - PG client for transaction support.
     */
    async update(client) {
        if (!this.id) throw new Error("Cannot update project: ID is missing.");

        const query = `
            UPDATE project
            SET
                name = $1,
                description = $2,
                auxdata = $3,
                last_modified_timestamp = NOW() -- CRITICAL: Use new column name
            WHERE id = $4
            RETURNING last_modified_timestamp;
        `;
        const values = [
            this.projectName,
            this.description,
            this.auxData,
            this.id
        ];

        // Use the passed client (from ProjectService's transaction)
        const result = await client.query(query, values);
        this.lastModifiedDate = result.rows[0].last_modified_timestamp;
    }


    /**
     * Fetches a project by its ID.
     * @param {number} id
     */
    static async findById(id) {
        const query = `SELECT * FROM project WHERE id = $1;`;
        const result = await db.query(query, [id]);

        if (result.rows.length === 0) return null;

        // Map the database row to a ProjectModel instance (uses constructor logic)
        return new ProjectModel(result.rows[0]);
    }

}
