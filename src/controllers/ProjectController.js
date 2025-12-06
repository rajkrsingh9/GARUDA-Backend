// backend/src/controllers/ProjectController.js

import { Router } from 'express';
import { ProjectService } from '../services/ProjectService.js';
import { RoleTokenModel } from '../models/RoleTokenModel.js';


/**
 * ProjectController: Handles routing and HTTP request/response logic for projects.
 * Updated for subscription-based flow with permission checking.
 */
export class ProjectController {
    router;
    projectService;

    constructor() {
        this.router = Router();
        this.projectService = new ProjectService();
        this.initializeRoutes();
    }

    initializeRoutes() {
        this.router.post('/', this.createProject);
        this.router.get('/', this.getProjectsByUser);
        this.router.get('/roles', this.getRoleTokens);
        this.router.get('/alert-channels', this.getAlertChannels);

        // CRITICAL: Specific routes MUST come before parameterized routes
        this.router.get('/:id/permissions', this.getUserPermissions); // Before /:id
        this.router.get('/:id/alerts', this.getProjectAlerts); // Before /:id

        // Parameterized routes come last
        this.router.get('/:id', this.getProjectDetails);
        this.router.put('/:id', this.updateProject);
        this.router.delete('/:id', this.deleteProject);
    }

    /**
     * POST /api/projects
     * Creates a new project
     */
    createProject = async (req, res) => {
        const currentUserId = req.header('X-User-ID') || 'user123';
        const projectBundle = req.body;

        try {
            const newProject = await this.projectService.createProject(projectBundle, currentUserId);

            return res.status(201).json({
                message: 'Project created successfully.',
                project: newProject
            });
        } catch (error) {
            console.error('Controller Error during project creation:', error);
            return res.status(500).json({
                error: 'Failed to create project.',
                details: error.message
            });
        }
    }

    /**
     * GET /api/projects
     * Fetches all projects for the current user
     */
    getProjectsByUser = async (req, res) => {
        const currentUserId = req.header('X-User-ID') || 'user123';

        try {
            const projects = await this.projectService.getUserProjects(currentUserId);
            return res.status(200).json(projects);
        } catch (error) {
            console.error('Controller Error fetching projects:', error);
            return res.status(500).json({ error: 'Failed to fetch user projects.' });
        }
    }

    /**
     * GET /api/projects/:id
     * Fetches project details including subscriptions
     */
    getProjectDetails = async (req, res) => {
        const projectId = parseInt(req.params.id);

        if (isNaN(projectId)) {
            return res.status(400).json({ message: 'Invalid Project ID format.' });
        }

        try {
            const details = await this.projectService.getProjectDetails(projectId);

            if (!details) {
                return res.status(404).json({ message: 'Project not found.' });
            }

            return res.status(200).json(details);
        } catch (error) {
            console.error('Controller Error fetching project details:', error);
            return res.status(500).json({ error: 'Failed to fetch project details.' });
        }
    }

    // backend/src/controllers/ProjectController.js - FIXED getUserPermissions endpoint

    /**
     * GET /api/projects/:id/permissions
     * Fetches user permissions for a specific project
     */
    getUserPermissions = async (req, res) => {
        const projectId = parseInt(req.params.id);
        const currentUserId = req.header('X-User-ID') || 'user123';

        if (isNaN(projectId)) {
            return res.status(400).json({
                message: 'Invalid Project ID format.',
                error: 'PROJECT_ID_INVALID'
            });
        }

        try {
            const permissions = await this.projectService.getUserPermissions(projectId, currentUserId);
            return res.status(200).json(permissions);
        } catch (error) {
            console.error('[ProjectController] Error fetching permissions:', error);

            // Handle specific error cases
            if (error.message === 'Project not found') {
                return res.status(404).json({
                    error: 'Project not found.',
                    message: error.message
                });
            }

            if (error.message === 'User does not have access to this project') {
                return res.status(403).json({
                    error: 'Access denied.',
                    message: error.message
                });
            }

            // Generic error
            return res.status(500).json({
                error: 'Failed to fetch permissions.',
                message: error.message,
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    }

    /**
     * PUT /api/projects/:id
     * Updates an existing project
     */
    updateProject = async (req, res) => {
        const projectId = parseInt(req.params.id);
        const currentUserId = req.header('X-User-ID') || 'user123';

        if (isNaN(projectId)) {
            return res.status(400).json({ message: 'Invalid Project ID format.' });
        }

        const projectBundle = req.body;

        try {
            // Check permissions before update
            const permissions = await this.projectService.getUserPermissions(projectId, currentUserId);

            if (!permissions.isOwner && !permissions.isAdmin) {
                // Check if user has required permissions for the changes
                const hasProjectInfoUpdate = permissions.roles.includes(2); // project_info_update
                const hasUserUpdate = permissions.roles.includes(3); // user_update
                const hasAoiUpdate = permissions.roles.includes(4); // aoi_update
                const hasSubscriptionUpdate = permissions.roles.includes(5); // subscription_update

                // Validate permissions for each section
                if (projectBundle.projectBasicInfo && !hasProjectInfoUpdate) {
                    return res.status(403).json({
                        error: 'Permission denied: project_info_update required'
                    });
                }
                if (projectBundle.userData && !hasUserUpdate) {
                    return res.status(403).json({
                        error: 'Permission denied: user_update required'
                    });
                }
                if (projectBundle.aoiData && !hasAoiUpdate) {
                    return res.status(403).json({
                        error: 'Permission denied: aoi_update required'
                    });
                }
                if (projectBundle.subscriptionData && !hasSubscriptionUpdate) {
                    return res.status(403).json({
                        error: 'Permission denied: subscription_update required'
                    });
                }
            }

            const updatedProject = await this.projectService.updateProject(
                projectId,
                projectBundle,
                currentUserId
            );

            return res.status(200).json({
                message: 'Project updated successfully.',
                project: updatedProject
            });
        } catch (error) {
            console.error('Controller Error during project update:', error);
            const statusCode = error.message.includes('not found') ? 404 : 500;
            return res.status(statusCode).json({
                error: 'Failed to update project.',
                details: error.message
            });
        }
    }

    /**
     * DELETE /api/projects/:id
     * Deletes a project (only owner/admin can delete)
     */
    deleteProject = async (req, res) => {
        const projectId = parseInt(req.params.id);
        const currentUserId = req.header('X-User-ID') || 'user123';

        try {
            // Check if user is owner or admin
            const permissions = await this.projectService.getUserPermissions(projectId, currentUserId);

            if (!permissions.isOwner && !permissions.isAdmin) {
                return res.status(403).json({
                    error: 'Permission denied: Only project owner or admin can delete projects.'
                });
            }

            const success = await this.projectService.deleteProject(projectId);

            if (success) {
                return res.status(204).send();
            } else {
                return res.status(404).json({ message: 'Project not found or already deleted.' });
            }
        } catch (error) {
            console.error('Controller Error deleting project:', error);
            return res.status(500).json({ error: 'Failed to delete project.' });
        }
    }

    /**
     * GET /api/projects/alert-channels
     * Fetches the alert channel catalogue
     */
    getAlertChannels = async (req, res) => {
        try {
            const channels = await this.projectService.getAlertChannelCatalogue();
            return res.status(200).json(channels);
        } catch (error) {
            console.error('Controller Error fetching alert channels:', error);
            return res.status(500).json({ error: 'Failed to fetch alert channels.' });
        }
    }

    getRoleTokens = async (req, res) => {
        try {
            const roles = await RoleTokenModel.findAll();
            return res.status(200).json(roles);
        } catch (error) {
            console.error('Error fetching role tokens:', error);
            return res.status(500).json({ error: 'Failed to fetch roles.' });
        }
    };

    /**
     * GET /api/projects/:id/alerts
     * Fetches all alerts for a project
     */
    getProjectAlerts = async (req, res) => {
        const projectId = parseInt(req.params.id);
        const aoiId = req.query.aoiId || null;

        if (isNaN(projectId)) {
            return res.status(400).json({ message: 'Invalid Project ID format.' });
        }

        try {
            console.log(`[ProjectController] Fetching alerts for project ${projectId}, AOI: ${aoiId}`);
            const { alerts, timeRange } = await this.projectService.getProjectAlerts(projectId, aoiId);
            console.log(`[ProjectController] Found ${alerts.length} alerts`);
            return res.status(200).json({ alerts, timeRange });
        } catch (error) {
            console.error('Controller Error fetching project alerts:', error);
            return res.status(500).json({
                error: 'Failed to fetch project alerts.',
                details: error.message
            });
        }
    }
}