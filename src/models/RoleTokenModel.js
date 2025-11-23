// backend/src/models/RoleTokenModel.js
import { DBClient } from '../db/DBClient.js';
const db = DBClient.getInstance();

export class RoleTokenModel {
    id = null;
    role = null;

    constructor(row) {
        this.id = row.id;
        this.role = row.role;
    }

    static async findAll() {
        const query = `SELECT id, role FROM role_token ORDER BY role;`;
        const result = await db.query(query);
        return result.rows.map(r => new RoleTokenModel(r));
    }

    static async findByRoleName(roleName) {
        const query = `SELECT id, role FROM role_token WHERE LOWER(role) = LOWER($1) LIMIT 1;`;
        const result = await db.query(query, [roleName]);
        if (result.rows.length === 0) return null;
        return new RoleTokenModel(result.rows[0]);
    }
}
