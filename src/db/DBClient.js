// DBClient.js

import { Pool } from 'pg';

import * as dotenv from 'dotenv';

dotenv.config();

// Singleton class for managing the PostgreSQL connection pool
export class DBClient {
    static instance;
    // CRITICAL: Make the pool public so ProjectService can manage transactions
    pool;

    constructor() {
        this.pool = new Pool({
            user: process.env.DB_USER,
            host: process.env.DB_HOST,
            database: process.env.DB_DATABASE,
            password: process.env.DB_PASSWORD,
            port: parseInt(process.env.DB_PORT || '5432'),
        });

        this.pool.on('error', (err) => {
            console.error('Unexpected error on idle client', err);
        });
        console.log('Database Pool Initialized.');
    }

    static getInstance() {
        if (!DBClient.instance) {
            DBClient.instance = new DBClient();
        }
        return DBClient.instance;
    }

    // Generic method to execute SQL queries (used outside of transactions)
    async query(text, params = []) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(text, params);
            return result;
        } catch (error) {
            console.error('Database query error:', error);
            throw error;
        } finally {
            client.release();
        }
    }
}
