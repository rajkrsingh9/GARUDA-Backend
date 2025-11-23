// backend/src/services/ProjectService.js
import { DBClient } from '../db/DBClient.js';
import { ProjectModel } from '../models/ProjectModel.js';
import { AreaOfInterestModel } from '../models/AreaOfInterestModel.js';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import { AlertChannelCatalogueModel } from '../models/AlertChannelCatalogueModel.js';
import { UsersToProjectModel } from '../models/UsersToProjectModel.js'; // ADDED: Missing import

const db = DBClient.getInstance();

export class ProjectService {

    /**
     * Creates a new project with AOIs and subscriptions
     * FIXED: Proper subscription validation using aoiId
     */
    async createProject(bundle, currentUserId) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const { projectName, description, auxData } = bundle.projectBasicInfo;

            // FIXED: Validation - Ensure all AOIs have at least one active subscription
            if (bundle.aoiData && bundle.aoiData.length > 0) {
                for (const aoi of bundle.aoiData) {
                    // Generate the aoiId that will be used in the DB
                    const aoiIdToCheck = aoi.aoiId || `aoi_${aoi.clientAoiId || Date.now()}`;

                    const hasSubscription = bundle.subscriptionData?.some(
                        sub => sub.aoiId === aoiIdToCheck && sub.status !== 2
                    );

                    if (!hasSubscription) {
                        throw new Error(
                            `AOI "${aoi.name}" must have at least one alert channel subscription. ` +
                            `Expected aoiId: ${aoiIdToCheck}`
                        );
                    }
                }
            }

            // 1. Create the Project record
            const projectResult = await client.query(`
                INSERT INTO project
                (name, description, created_by_userid, auxdata)
                VALUES ($1, $2, $3, $4)
                RETURNING id, creation_timestamp;
            `, [projectName, description, currentUserId, auxData]);

            const projectId = projectResult.rows[0].id;

            const newProject = new ProjectModel({
                id: projectId,
                name: projectName,
                description: description,
                created_by_userid: currentUserId,
                auxdata: auxData,
                creation_timestamp: projectResult.rows[0].creation_timestamp
            });

            // 2. Add Users to Project WITH ROLES
            // FIXED: Ensure current user is added if not in userData
            const userDataWithCreator = [...bundle.userData];
            if (!userDataWithCreator.some(u => u.userId === currentUserId)) {
                userDataWithCreator.push({ userId: currentUserId, roles: [] });
            }

            for (const user of userDataWithCreator) {
                const model = new UsersToProjectModel({
                    user_id: user.userId,
                    project_id: projectId,
                    user_role: user.roles || []
                });
                await model.save(client);
            }

            // 3. Process AOIs with multi-polygon support
            // CRITICAL: Track aoiId mappings for subscription insertion
            const aoiIdMap = new Map(); // clientAoiId -> actual aoiId

            for (const aoiItem of bundle.aoiData) {
                const geomString = JSON.stringify(aoiItem.geomGeoJson);

                if (!geomString || geomString.length < 10) {
                    throw new Error("Invalid GeoJSON geometry provided for AOI: " + aoiItem.name);
                }

                // FIXED: Ensure aoiId is set consistently
                const finalAoiId = aoiItem.aoiId || `aoi_${aoiItem.clientAoiId || Date.now()}`;
                aoiIdMap.set(aoiItem.clientAoiId, finalAoiId);

                if (aoiItem.geomGeoJson.type === 'GeometryCollection') {
                    const bufferConfig = aoiItem.geomProperties?.bufferConfig || [];
                    const geometryParts = [];

                    for (let idx = 0; idx < aoiItem.geomGeoJson.geometries.length; idx++) {
                        const geom = aoiItem.geomGeoJson.geometries[idx];
                        const config = bufferConfig[idx] || {};
                        const buffer = Number(config.buffer) || 0;
                        const geomType = geom.type;
                        const individualGeomStr = JSON.stringify(geom);

                        if (geomType === 'Point' || geomType === 'LineString') {
                            const bufferedResult = await client.query(`
                                SELECT ST_AsText(
                                    ST_Transform(
                                        ST_Buffer(
                                            ST_Transform(ST_GeomFromGeoJSON($1::text), 3857),
                                            $2::float
                                        ),
                                        4326
                                    )
                                ) as geom_wkt
                            `, [individualGeomStr, buffer > 0 ? buffer : 0.0001]);
                            geometryParts.push(bufferedResult.rows[0].geom_wkt);
                        } else {
                            const result = await client.query(`
                                SELECT ST_AsText(ST_GeomFromGeoJSON($1::text)) as geom_wkt
                            `, [individualGeomStr]);
                            geometryParts.push(result.rows[0].geom_wkt);
                        }
                    }

                    const unionQuery = `
                        SELECT ST_AsText(
                            ST_Union(ARRAY[${geometryParts.map((_, i) => `ST_GeomFromText($${i + 1}, 4326)`).join(', ')}])
                        ) as final_geom_wkt
                    `;
                    const unionResult = await client.query(unionQuery, geometryParts);
                    const finalWKT = unionResult.rows[0].final_geom_wkt;

                    const aoiQuery = `
                        INSERT INTO area_of_interest
                        (project_id, aoi_id, name, geom, geom_properties, status)
                        VALUES ($1, $2, $3, ST_GeomFromText($4, 4326), $5, 1)
                        RETURNING id;
                    `;
                    await client.query(aoiQuery, [
                        projectId,
                        finalAoiId,
                        aoiItem.name,
                        finalWKT,
                        aoiItem.geomProperties
                    ]);

                } else {
                    const buffer = Number(aoiItem.geomProperties?.buffer) || 0;

                    const aoiQuery = `
                        WITH original_geom AS (
                            SELECT ST_GeomFromGeoJSON($4::text) AS geom
                        )
                        INSERT INTO area_of_interest
                        (project_id, aoi_id, name, geom, geom_properties, status)
                        SELECT
                            $1, $2, $3,
                            CASE
                                WHEN ST_GeometryType(geom) IN ('ST_Point', 'ST_LineString') THEN
                                    ST_Transform(
                                        ST_Buffer(
                                            ST_Transform(geom, 3857),
                                            CASE WHEN $5::float > 0 THEN $5::float ELSE 0.0001 END
                                        ),
                                        4326
                                    )
                                ELSE geom
                            END,
                            $6, 1
                        FROM original_geom
                        RETURNING id;
                    `;
                    await client.query(aoiQuery, [
                        projectId,
                        finalAoiId,
                        aoiItem.name,
                        geomString,
                        buffer,
                        aoiItem.geomProperties
                    ]);
                }
            }

            // 4. Process Subscriptions
            // FIXED: Use the mapped aoiId from the database
            if (bundle.subscriptionData && bundle.subscriptionData.length > 0) {
                for (const sub of bundle.subscriptionData) {
                    if (sub.status !== 2) {
                        // CRITICAL: Use the actual aoiId that was inserted into the DB
                        const actualAoiId = aoiIdMap.get(sub.aoiId) || sub.aoiId;

                        const subscription = new SubscriptionModel({
                            project_id: projectId,
                            aoi_id: actualAoiId, // Use mapped aoiId
                            channel_id: sub.channelId,
                            user_ids: sub.userIds,
                            alert_dissemination_mode: sub.alertDisseminationMode,
                            auxdata: sub.auxData,
                            status: sub.status
                        });
                        await subscription.save(client);
                    }
                }
            }

            await client.query('COMMIT');
            return newProject;

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Project creation failed, transaction rolled back:', error);
            throw new Error(`Transaction failed. Details: ${error.message}`);
        } finally {
            client.release();
        }
    }

    /**
     * Updates an existing project
     * FIXED: Proper subscription validation and aoiId handling
     */
    async updateProject(projectId, bundle, currentUserId) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // FIXED: Validation - Ensure all active AOIs have at least one subscription
            if (bundle.aoiData && bundle.aoiData.length > 0) {
                for (const aoi of bundle.aoiData) {
                    if (aoi.status !== 2) { // Only check active AOIs
                        const aoiIdToCheck = aoi.aoiId || `aoi_${aoi.clientAoiId || Date.now()}`;

                        const hasSubscription = bundle.subscriptionData?.some(
                            sub => sub.aoiId === aoiIdToCheck && sub.status !== 2
                        );

                        if (!hasSubscription) {
                            throw new Error(
                                `AOI "${aoi.name}" must have at least one alert channel subscription. ` +
                                `Expected aoiId: ${aoiIdToCheck}`
                            );
                        }
                    }
                }
            }

            // 1. Update Project Basic Info
            const projectModel = await ProjectModel.findById(projectId);
            if (!projectModel) {
                throw new Error(`Project with ID ${projectId} not found.`);
            }

            projectModel.projectName = bundle.projectBasicInfo.projectName;
            projectModel.description = bundle.projectBasicInfo.description;
            projectModel.auxData = bundle.projectBasicInfo.auxData;
            await projectModel.update(client);

            // 2. Update Users WITH ROLES
            await UsersToProjectModel.deleteByProject(client, projectId);

            // FIXED: Ensure current user is included
            const userDataWithCreator = [...bundle.userData];
            if (!userDataWithCreator.some(u => u.userId === currentUserId)) {
                userDataWithCreator.push({ userId: currentUserId, roles: [] });
            }

            // REINSERT ALL WITH ROLES
            for (const user of userDataWithCreator) {
                const model = new UsersToProjectModel({
                    user_id: user.userId,
                    project_id: projectId,
                    user_role: user.roles || []
                });
                await model.save(client);
            }

            // 3. Process AOIs (same as create - code omitted for brevity)
            const processedAoiIds = new Set();
            const aoiIdMap = new Map();

            for (const aoiItem of bundle.aoiData) {
                const { aoiId, dbId, status, name, geomGeoJson, geomProperties, clientAoiId } = aoiItem;
                const finalAoiId = aoiId || `aoi_${clientAoiId || Date.now()}`;

                if (processedAoiIds.has(finalAoiId)) {
                    console.error(`[Update] Duplicate aoiId detected: ${finalAoiId}. Skipping.`);
                    continue;
                }
                processedAoiIds.add(finalAoiId);
                aoiIdMap.set(clientAoiId, finalAoiId);

                if (dbId) {
                    if (status === 2) {
                        await client.query(
                            `UPDATE area_of_interest SET status = 2 WHERE id = $1;`,
                            [dbId]
                        );
                        await client.query(
                            `UPDATE subscription SET status = 2 
                             WHERE project_id = $1 AND aoi_id = $2;`,
                            [projectId, finalAoiId]
                        );
                        continue;
                    } else {
                        await client.query(
                            `UPDATE area_of_interest 
                             SET name = $1, geom_properties = $2, status = $3 
                             WHERE id = $4;`,
                            [name, geomProperties, status, dbId]
                        );
                    }
                } else {
                    // Insert new AOI (same logic as createProject - omitted for brevity)
                    const geomString = JSON.stringify(geomGeoJson);
                    const buffer = Number(geomProperties?.buffer) || 0;

                    await client.query(`
                        WITH original_geom AS (
                            SELECT ST_GeomFromGeoJSON($4::text) AS geom
                        )
                        INSERT INTO area_of_interest
                        (project_id, aoi_id, name, geom, geom_properties, status)
                        SELECT $1, $2, $3,
                            CASE
                                WHEN ST_GeometryType(geom) IN ('ST_Point', 'ST_LineString') THEN
                                    ST_Transform(
                                        ST_Buffer(
                                            ST_Transform(geom, 3857),
                                            CASE WHEN $5::float > 0 THEN $5::float ELSE 0.0001 END
                                        ),
                                        4326
                                    )
                                ELSE geom
                            END,
                            $6, 1
                        FROM original_geom;
                    `, [projectId, finalAoiId, name, geomString, buffer, geomProperties]);
                }
            }

            // 4. Process Subscriptions
            if (bundle.subscriptionData && bundle.subscriptionData.length > 0) {
                for (const sub of bundle.subscriptionData) {
                    const actualAoiId = aoiIdMap.get(sub.aoiId) || sub.aoiId;

                    if (sub.subscriptionId) {
                        if (sub.status === 2) {
                            await SubscriptionModel.softDelete(client, sub.subscriptionId);
                        } else {
                            const subscription = new SubscriptionModel({
                                id: sub.subscriptionId,
                                project_id: projectId,
                                aoi_id: actualAoiId,
                                channel_id: sub.channelId,
                                user_ids: sub.userIds,
                                alert_dissemination_mode: sub.alertDisseminationMode,
                                auxdata: sub.auxData,
                                status: sub.status
                            });
                            await subscription.update(client);
                        }
                    } else if (sub.status !== 2) {
                        const subscription = new SubscriptionModel({
                            project_id: projectId,
                            aoi_id: actualAoiId,
                            channel_id: sub.channelId,
                            user_ids: sub.userIds,
                            alert_dissemination_mode: sub.alertDisseminationMode,
                            auxdata: sub.auxData,
                            status: sub.status
                        });
                        await subscription.save(client);
                    }
                }
            }

            await client.query('COMMIT');
            return projectModel;

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Project update failed, transaction rolled back:', error);
            throw new Error(`Update failed. Details: ${error.message}`);
        } finally {
            client.release();
        }
    }

    async getUserProjects(userId) {
        const query = `
            SELECT
                p.id, p.name as project_name, p.description, 
                p.creation_timestamp, p.last_modified_timestamp, 
                p.created_by_userid, p.auxdata
            FROM project p
            JOIN users_to_project up ON p.id = up.project_id
            WHERE up.user_id = $1
            ORDER BY p.last_modified_timestamp DESC;
        `;
        const result = await db.query(query, [userId]);
        return result.rows;
    }

    async getProjectDetails(projectId) {
        const client = await db.pool.connect();
        try {
            const projectResult = await client.query(`
                SELECT id, name as project_name, description, creation_timestamp, 
                       last_modified_timestamp, created_by_userid, auxdata 
                FROM project WHERE id = $1;
            `, [projectId]);

            if (projectResult.rows.length === 0) return null;
            const project = projectResult.rows[0];

            const userResult = await UsersToProjectModel.findByProjectId(projectId);

            const aois = await AreaOfInterestModel.findByProjectId(projectId);

            const aoisWithData = [];
            for (const aoiInstance of aois) {
                if (!aoiInstance.geomGeoJson) continue;

                const subscriptions = await SubscriptionModel.findByAoiWithDetails(
                    projectId,
                    aoiInstance.aoiId
                );

                aoisWithData.push({
                    id: aoiInstance.id,
                    project_id: aoiInstance.projectId,
                    aoi_id: aoiInstance.aoiId,
                    name: aoiInstance.name,
                    auxdata: aoiInstance.auxData,
                    geom_properties: aoiInstance.geomProperties,
                    geomGeoJson: aoiInstance.geomGeoJson,
                    status: aoiInstance.status || 1,
                    subscriptions: subscriptions.map(sub => ({
                        subscriptionId: sub.id,
                        channelId: sub.channel_id,
                        channelName: sub.channel_name,
                        category: sub.category,
                        userIds: sub.user_ids,
                        status: sub.status
                    }))
                });
            }

            return {
                ...project,
                users: userResult.map(u => ({
                    userId: u.userId,
                    roles: u.roles
                })),
                aois: aoisWithData,
            };
        } finally {
            client.release();
        }
    }

    async deleteProject(projectId) {
        const query = `DELETE FROM project WHERE id = $1;`;
        const result = await db.query(query, [projectId]);
        return result.rowCount > 0;
    }

    async getAlertChannelCatalogue() {
        const channels = await AlertChannelCatalogueModel.findAll();
        return channels.map(ch => ({
            id: ch.id,
            script_id: ch.scriptId,
            script_name: ch.scriptName,
            channel_name: ch.channelName,
            category: ch.category,
            args: ch.args
        }));
    }

    async getProjectAlerts(projectId, aoiId = null) {
        let aoiFilter = '';
        const params = [projectId];

        if (aoiId) {
            params.push(aoiId);
            aoiFilter = ` AND s.aoi_id = $${params.length}`;
        }

        const query = `
        SELECT
            a.id,
            a.content AS message,
            a.alert_timestamp AS timestamp,
            p.name AS project_name,
            aoi.name AS aoi_name,
            s.aoi_id,
            s.project_id,
            s.channel_id,
            acc.channel_name
        FROM alerts a
        JOIN subscription s ON a.subscription_id = s.id
        JOIN project p ON s.project_id = p.id
        JOIN area_of_interest aoi 
            ON s.project_id = aoi.project_id 
            AND s.aoi_id = aoi.aoi_id
        JOIN alert_channel_catalogue acc ON s.channel_id = acc.id
        WHERE s.project_id = $1
        ${aoiFilter}
        ORDER BY a.alert_timestamp ASC;
    `;

        console.log('[ProjectService] Running query with params:', params);

        const result = await db.query(query, params);

        const timestamps = result.rows.map(r => new Date(r.timestamp).getTime());
        const firstTimestamp = timestamps.length ? Math.min(...timestamps) : null;
        const lastTimestamp = timestamps.length ? Math.max(...timestamps) : null;

        return {
            alerts: result.rows.map(row => ({
                id: row.id,
                projectId: row.project_id,
                projectName: row.project_name,
                aoiId: row.aoi_id,
                aoiName: row.aoi_name,
                channelId: row.channel_id,
                channelName: row.channel_name,
                message: row.message,
                timestamp: row.timestamp
            })),
            timeRange: { from: firstTimestamp, to: lastTimestamp }
        };
    }
}