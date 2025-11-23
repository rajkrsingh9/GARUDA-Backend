// UserModel.js

import { DBClient } from '../db/DBClient.js';

const db = DBClient.getInstance();

/**
 * UserModel: Handles persistence logic for the 'users' table.
 */
export class UserModel {
    userId = null;
    username = null;
    passwordHash = null;
    contactNo = null;
    email = null;

    constructor(data) {
        this.userId = data.user_id;
        this.username = data.username || data.user_id;
        this.passwordHash = data.password_hash || null;
        this.contactNo = data.contactno || null;
        this.email = data.email || null;
    }

    /**
     * Finds a user by their unique user_id.
     */
    static async findById(userId) {
        const query = `SELECT * FROM users WHERE user_id = $1;`;
        const result = await db.query(query, [userId]);
        
        if (result.rows.length === 0) return null;
        return new UserModel(result.rows[0]);
    }

    /**
     * Inserts a new user into the database (Sign Up).
     */
    async save() {
        const query = `
            INSERT INTO users (user_id, username, password_hash, contactno, email)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING user_id, username;
        `;
        const values = [this.userId, this.username, this.passwordHash, this.contactNo, this.email];
        
        const result = await db.query(query, values);
        return new UserModel(result.rows[0]);
    }

    /**
     * Fetches user profile - simplified to only return basic user information.
     * No project statistics needed.
     * @param {string} userId
     * @returns {Promise<Object>}
     */
    static async getUserProfileWithStats(userId) {
        // Query: Get user basic information only
        const userQuery = `
            SELECT user_id, username, email, contactno 
            FROM users 
            WHERE user_id = $1;
        `;
        const userResult = await db.query(userQuery, [userId]);

        if (userResult.rows.length === 0) {
            return null;
        }

        const userData = userResult.rows[0];

        // Return only user details without project statistics
        return {
            user_id: userData.user_id,
            username: userData.username,
            email: userData.email,
            contactno: userData.contactno
        };
    }
}