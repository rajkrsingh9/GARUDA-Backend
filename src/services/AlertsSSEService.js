// AlertsSSEService.js

import { Kafka } from 'kafkajs';
import { createClient } from '@redis/client';
import { DBClient } from '../db/DBClient.js'; // Used to look up which users are assigned to a project

// --- CONFIGURATION ---
// The Kafka topic name where PostgreSQL (via Debezium/CDC) publishes new 'alerts' records.
const KAFKA_TOPIC = 'dbserver1.public.alerts';
// Group ID for the Kafka consumer, ensures messages aren't processed by other instances.
const KAFKA_GROUP_ID = 'garuda-alerts-group';
// Connection URL for Redis (used for alert caching/history).
const REDIS_URL = 'redis://localhost:6379';
// List of Kafka broker addresses.
const KAFKA_BROKERS = ['localhost:9092'];
// ---

// Map to hold **active HTTP connections** (Server-Sent Events) for each logged-in user.
// Key: userId, Value: Array of Express Response objects (one for each open browser tab).
let sseClients = {};

// Initialize the Redis client.
const redisClient = createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Client Error', err));

// Initialize the Kafka client and configure retries for robustness.
const kafka = new Kafka({
    clientId: 'garuda-alert-consumer',
    brokers: KAFKA_BROKERS,
    retry: {
        initialRetryTime: 1000,
        retries: 50, // Keep trying to connect to the Kafka broker
    }
});
// Create the Kafka consumer instance that belongs to a group.
const consumer = kafka.consumer({ groupId: KAFKA_GROUP_ID });
const db = DBClient.getInstance(); // Get the single database connection pool instance

/**
 * Sends a notification object instantly to any client (browser tab) currently connected
 * via the SSE stream for a specific user.
 * @param {string} userId
 * @param {Record<string, any>} notification
 */
function sendToSSEClient(userId, notification) {
    const clients = sseClients[userId];
    // Format the message according to the Server-Sent Events specification: 'data: {payload}\n\n'
    const notifString = `data: ${JSON.stringify(notification)}\n\n`;

    if (clients && clients.length > 0) {
        console.log(`SSE: Sending alert to ${clients.length} clients for user ${userId}`);
        clients.forEach(client => {
            client.write(notifString); // Push data instantly to the browser
        });
    } else {
        // If the user is offline, the alert is only saved in Redis (Step 4)
        console.log(`SSE: User ${userId} is offline. Alert stored in Redis.`);
    }
}

/**
 * Kafka consumer logic. This is the heart of the real-time system.
 */
async function runKafkaConsumer() {
    try {
        await redisClient.connect();

        await consumer.connect();
        await consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: false });

        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                const messageValue = message.value?.toString();
                if (!messageValue) return;

                try {
                    const data = JSON.parse(messageValue);
                    const payload = data?.payload?.after;
                    if (!payload || data.payload.op !== 'c') {
                        console.log(`CDC: Skipping message (op: ${data?.payload?.op})`);
                        return;
                    }

                    // --- CORE LOGIC: Fetch all users' contact details for the project ---
                    const subscriptionId = payload.subscription_id; // CHANGED: Use subscription_id

                    // Step 1: Fetch Project ID, AOI ID, and Channel ID from the subscription table
                    // NOTE: We assume 'change_algo_id' or equivalent is stored in the subscription's auxdata
                    // or we omit it for now, as it's not directly in the subscription table schema.
                    // For now, let's join to the subscription table.
                    const subscriptionResult = await db.query(
    `SELECT project_id, aoi_id, channel_id, user_ids 
     FROM subscription WHERE id = $1`,
    [subscriptionId]
);
                    if (subscriptionResult.rows.length === 0) {
                        console.log(`CDC: Subscription ID ${subscriptionId} not found. Skipping alert.`);
                        return;
                    }
                    // CHANGED: Destructure subscription fields
const { project_id, aoi_id, channel_id, user_ids } = subscriptionResult.rows[0];

                    // Step 1b: Fetch project and AOI names, and also the channel name/details
                    // NOTE: The 'algo_id' is now the 'channel_id' for simplicity based on the logic flow.
                    const projectDetails = await db.query(
                        `SELECT p.name AS project_name, aoi.name AS aoi_name, acc.channel_name
                         FROM project p, area_of_interest aoi, alert_channel_catalogue acc
                         WHERE p.id = $1 
                         AND aoi.project_id = $1 AND aoi.aoi_id = $2
                         AND acc.id = $3`,
                        [project_id, aoi_id, channel_id] // CHANGED: Use channel_id
                    );

                    const project_name = projectDetails.rows[0]?.project_name || `Project ${project_id}`;
                    const aoi_name = projectDetails.rows[0]?.aoi_name || `AOI ${aoi_id}`;
                    const channel_name = projectDetails.rows[0]?.channel_name || `Channel ${channel_id}`; // NEW


                    
// Then fetch user details only for subscribed users
const usersResult = await db.query(
    `SELECT u.user_id, u.email, u.contactno 
     FROM users u
     WHERE u.user_id = ANY($1)`,
    [user_ids]  // Use the subscription's user_ids array
);

                    // Step 2: Fetch all users (with contact details) associated with the project
                    // const usersResult = await db.query(
                    //     `SELECT u.user_id, u.email, u.contactno 
                    //      FROM users_to_project up
                    //      JOIN users u ON up.user_id = u.user_id
                    //      WHERE up.project_id = $1`,
                    //     [project_id]
                    // );

                    const recipientUsers = usersResult.rows;

                    if (recipientUsers.length === 0) {
                        console.log(`CDC: No users found for project ${project_id}. Skipping alert.`);
                        return;
                    }

                    // Structure the alert data for the frontend notification dropdown
                    const notification = {
                        id: payload.id,
                        message: payload.content,
                        projectId: project_id,
                        aoiId: aoi_id,
                        channelId: channel_id,        // ADD: Numeric ID
                        channelName: channel_name,    // CHANGE: Use consistent naming
                        timestamp: payload.alert_timestamp,
                        project_name: project_name,
                        aoi_name: aoi_name,
                        title: `${project_name}: ${aoi_name} via ${channel_name} alert`,
                    };

                    // Process the alert for each recipient user
                    for (const user of recipientUsers) {
                        const notifString = JSON.stringify(notification);

                        // 1. REDIS Caching (Persistence for Offline Users)
                        await redisClient.lPush(`alerts:${user.user_id}`, notifString);
                        await redisClient.lTrim(`alerts:${user.user_id}`, 0, 49);

                        // 2. SSE Delivery (Real-time Push)
                        sendToSSEClient(user.user_id, notification);

                        // 3. Dummy Email/SMS Push (Your Request)
                        if (user.email) {
                            console.log(`[Alert Push] Dummy Email SENT to ${user.email} (User: ${user.user_id})`);
                        }
                        if (user.contactno) {
                            console.log(`[Alert Push] Dummy SMS SENT to ${user.contactno} (User: ${user.user_id})`);
                        }
                    }

                } catch (err) {
                    console.error('Error processing Kafka message:', err);
                }
            },
        });
        console.log('⚡️ AlertsSSEService: Kafka consumer is running.');
    } catch (error) {
        console.error('🚨 AlertsSSEService: Kafka or Redis connection failed:', error);
    }
}


/**
 * Initializes the entire real-time alert system by setting up
 * the SSE HTTP endpoint and starting the Kafka consumer worker.
 * @param {import('express').Application} app
 */
export function initAlertsSSE(app) {
    // 1. SSE Endpoint for Client Connection (The browser connects here to listen)
    app.get('/api/alerts/events/:userId', async (req, res) => {
        const { userId } = req.params;

        // Set mandatory headers for Server-Sent Events stream
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders(); // Send headers immediately

        // Register the active HTTP response object in the map
        if (!sseClients[userId]) sseClients[userId] = [];
        sseClients[userId].push(res);

        // **REDIS: Send Historical/Missed Notifications on Connect**
        try {
            // lRange retrieves the stored list of alerts (newest first)
            const notifs = await redisClient.lRange(`alerts:${userId}`, 0, -1);
            // Send each cached alert immediately to the newly connected client
            notifs.forEach(msg => res.write(`data: ${msg}\n\n`));
        } catch (err) {
            console.error('Redis historical fetch error:', err);
        }

        // Remove the connection from the map when the client closes the stream
        req.on('close', () => {
            sseClients[userId] = sseClients[userId].filter(client => client !== res);
        });
    });

    // 2. Mark as Read API (Allows the client to clear an alert from their Redis history)
    app.post('/api/alerts/mark-read', async (req, res) => {
        const { userId, notificationId } = req.body;

        try {
            // Fetches the current list of alert JSON strings from Redis
            const notifs = await redisClient.lRange(`alerts:${userId}`, 0, -1);

            let countBefore = notifs.length;
            // Filter out the alert with the matching ID
            const filtered = notifs.filter(nn => {
                try {
                    return JSON.parse(nn).id != notificationId;
                } catch {
                    return true; // Keep malformed items just in case
                }
            });

            if (filtered.length !== countBefore) {
                // Completely replace the old Redis list with the filtered, new list
                await redisClient.del(`alerts:${userId}`);
                if (filtered.length > 0) {
                    await redisClient.rPush(`alerts:${userId}`, filtered);
                }
            }

            res.json({ success: true, removed: countBefore - filtered.length });
        } catch (err) {
            console.error('Error marking alert as read:', err);
            res.status(500).json({ error: 'Failed to mark as read' });
        }
    });

    // 3. Start the Kafka Consumer worker process
    runKafkaConsumer();
}
