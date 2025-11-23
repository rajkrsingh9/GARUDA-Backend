// backend/src/models/UsersToProjectModel.js
import { DBClient } from '../db/DBClient.js';
const db = DBClient.getInstance();

export class UsersToProjectModel {
    id = null;
    userId = null;
    projectId = null;
    roles = []; // integer[]

    constructor(row) {
        this.id = row.id || null;
        this.userId = row.user_id;
        this.projectId = row.project_id;
        this.roles = row.user_role || [];
    }

    async save(client) {
        const query = `
            INSERT INTO users_to_project (user_id, project_id, user_role)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, project_id)
            DO UPDATE SET user_role = EXCLUDED.user_role
            RETURNING id;
        `;
        const result = await client.query(query, [
            this.userId,
            this.projectId,
            this.roles
        ]);

        this.id = result.rows[0].id;
        return this.id;
    }

    static async deleteByProject(client, projectId) {
        await client.query(
            `DELETE FROM users_to_project WHERE project_id = $1`,
            [projectId]
        );
    }

    static async deleteByProjectAndUser(client, projectId, userId) {
        await client.query(
            `DELETE FROM users_to_project WHERE project_id = $1 AND user_id = $2`,
            [projectId, userId]
        );
    }

    static async findByProjectId(projectId) {
        const result = await db.query(
            `SELECT * FROM users_to_project WHERE project_id = $1`,
            [projectId]
        );

        return result.rows.map(r => new UsersToProjectModel(r));
    }
}
