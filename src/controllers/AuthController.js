// AuthController.js
import { Router } from 'express';
import { UserModel } from '../models/UserModel.js'; // <-- Updated import
/**
 * AuthController: Handles user login and signup using the database.
 */
export class AuthController {
    router;

    constructor() {
        this.router = Router();
        this.initializeRoutes();
    }

    initializeRoutes() {
        this.router.post('/login', this.login);
        this.router.post('/signup', this.signup); 
        this.router.get('/profile/:userId', this.getUserProfile); 
        this.router.get('/exists/:userId', this.checkUserExists);

    }

    /**
     * POST /api/auth/login - Checks credentials against the users table.
     */
    login = async (req, res) => {
        const { username, password } = req.body;
        const userId = username; 

        try {
            const user = await UserModel.findById(userId);

            if (!user) {
                return res.status(401).json({ success: false, message: 'Invalid credentials or user not found.' });
            }

            // CRITICAL: Simple plain text password check (replace with bcrypt in production)
            if (user.passwordHash !== password) {
                return res.status(401).json({ success: false, message: 'Invalid credentials.' });
            }

            return res.status(200).json({
                success: true,
                userId: user.userId,
                username: user.username,
                message: 'Login successful'
            });
        } catch (error) {
            console.error('Login Error:', error);
            return res.status(500).json({ success: false, message: 'Server error during login.' });
        }
    }

    /**
     * POST /api/auth/signup - Creates a new user in the users table.
     */
    signup = async (req, res) => {
        const { username, password, email, contactno } = req.body; 
        const userId = username; // Use username as the unique user_id for simplicity

        
        // Simple validation
        if (!username || !password || username.length < 3 || password.length < 3) {
            return res.status(400).json({ success: false, message: 'Username and password must be at least 3 characters long.' });
        }

        try {
            // Check if user already exists
            const existingUser = await UserModel.findById(userId);
            if (existingUser) {
                return res.status(409).json({ success: false, message: 'User already exists.' });
            }

            // Create new user (password is stored as plain text for now)
            const newUser = new UserModel({
                user_id: userId,
                username: username,
                password_hash: password, // Plain text password for mock hash
                contactno: contactno || null, // <-- NEW
                email: email || null         // <-- NEW
            });
            await newUser.save();

            return res.status(201).json({
                success: true,
                userId: newUser.userId,
                username: newUser.username,
                message: 'Signup successful. Please log in.'
            });
        } catch (error) {
            console.error('Signup Error:', error);
            if (error.code === '23505') {
                return res.status(409).json({ success: false, message: 'User already exists (unique constraint violation).' });
            }
            return res.status(500).json({ success: false, message: 'Server error during signup.' });
        }
    }

        /**
     * GET /api/auth/profile/:userId - Fetches user profile with project statistics.
     */
    getUserProfile = async (req, res) => {
        const { userId } = req.params;
        const requestingUserId = req.header('X-User-ID');

        // Security check: Users can only view their own profile
        if (userId !== requestingUserId) {
            return res.status(403).json({ 
                success: false, 
                message: 'Unauthorized: You can only view your own profile.' 
            });
        }

        try {
            const userProfile = await UserModel.getUserProfileWithStats(userId);

            if (!userProfile) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'User not found.' 
                });
            }

            return res.status(200).json(userProfile);
        } catch (error) {
            console.error('Error fetching user profile:', error);
            return res.status(500).json({ 
                success: false, 
                message: 'Server error while fetching profile.' 
            });
        }
    }

    checkUserExists = async (req, res) => {
    const { userId } = req.params;
    try {
        const user = await UserModel.findById(userId);
        return res.json({ exists: !!user });
    } catch (error) {
        console.error('Check user exists error:', error);
        return res.status(500).json({ exists: false });
    }
}

}
