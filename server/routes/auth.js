const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const db = require("../db");
const { verifyToken, requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

// ==========================================
// TEST ROUTE
// ==========================================
router.get("/test", (req, res) => {
    res.json({
        success: true,
        message: "Authentication route is working!"
    });
});

// ==========================================
// PUBLIC STATS (For Landing Page)
// ==========================================
router.get("/public-stats", async (req, res) => {
    try {
        const [[eventsCount]] = await db.execute("SELECT COUNT(*) AS total FROM events");
        const [[regCount]] = await db.execute("SELECT COUNT(*) AS total FROM registrations WHERE registration_status != 'CANCELLED'");
        const [[studentsCount]] = await db.execute("SELECT COUNT(*) AS total FROM users WHERE role = 'student'");

        res.json({
            success: true,
            stats: {
                totalEvents: Number(eventsCount.total || 0),
                totalRegistrations: Number(regCount.total || 0),
                totalStudents: Number(studentsCount.total || 0)
            }
        });
    } catch (error) {
        console.error("Public stats error:", error.message);
        res.json({
            success: true,
            stats: {
                totalEvents: 10,
                totalRegistrations: 50,
                totalStudents: 100
            }
        });
    }
});

// ==========================================
// REGISTER
// ==========================================
router.post("/register", async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        if (!name || !email || !password || !role) {
            return res.status(400).json({
                success: false,
                message: "All fields are required."
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        if (role !== "student" && role !== "teacher") {
            return res.status(400).json({
                success: false,
                message: "Invalid role."
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters long."
            });
        }

        const [existing] = await db.execute(
            "SELECT id FROM users WHERE email = ?",
            [cleanEmail]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Email already registered."
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await db.execute(
            `INSERT INTO users
             (name, email, password, role)
             VALUES (?, ?, ?, ?)`,
            [name.trim(), cleanEmail, hashedPassword, role]
        );

        res.status(201).json({
            success: true,
            message: "User registered successfully.",
            userId: result.insertId
        });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({
            success: false,
            message: "Server error."
        });
    }
});

// ==========================================
// LOGIN
// ==========================================
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required."
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        const [users] = await db.execute(
            "SELECT * FROM users WHERE email = ?",
            [cleanEmail]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        const user = users[0];

        const passwordMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        // Admin is treated as teacher with organizer privileges
        const effectiveRole =
            user.role === "admin"
                ? "teacher"
                : user.role;

        // Update last_login timestamp safely
        await db.execute(
            "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?",
            [user.id]
        ).catch(err => console.warn("Failed to update last_login:", err.message));

        const token = jwt.sign(
            {
                id: user.id,
                name: user.name,
                email: user.email,
                role: effectiveRole
            },
            process.env.JWT_SECRET || "event_management_secret_2026",
            {
                expiresIn: "7d"
            }
        );

        res.json({
            success: true,
            message: "Login successful.",
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: effectiveRole
            }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({
            success: false,
            message: "Server error."
        });
    }
});

// ==========================================
// RESET PASSWORD (SIMPLIFIED DIRECT FLOW)
// ==========================================
router.post("/reset-password", async (req, res) => {
    try {
        const { email, newPassword, confirmPassword } = req.body;

        if (!email || !newPassword || !confirmPassword) {
            return res.status(400).json({
                success: false,
                message: "Email, new password, and confirm password are required."
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        if (!cleanEmail.includes("@")) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid email address."
            });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: "New password and confirm password must match."
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters long."
            });
        }

        // Check whether the email exists in the users table
        const [users] = await db.execute(
            "SELECT id, name, email FROM users WHERE email = ?",
            [cleanEmail]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No account found with this email address."
            });
        }

        const user = users[0];

        // Hash the new password using bcrypt
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update the user's password in the existing users table
        await db.execute(
            "UPDATE users SET password = ? WHERE id = ?",
            [hashedPassword, user.id]
        );

        return res.json({
            success: true,
            message: "Password updated successfully! Please sign in with your new password."
        });
    } catch (error) {
        console.error("Reset password error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to reset password at this time. Please try again."
        });
    }
});

// Backward compatibility alias for POST /forgot-password
router.post("/forgot-password", async (req, res) => {
    try {
        const { email, newPassword, confirmPassword } = req.body;

        // If client sends new password fields, route to reset-password
        if (newPassword || confirmPassword) {
            if (!email || !newPassword || !confirmPassword) {
                return res.status(400).json({
                    success: false,
                    message: "Email, new password, and confirm password are required."
                });
            }

            const cleanEmail = email.trim().toLowerCase();

            if (newPassword !== confirmPassword) {
                return res.status(400).json({
                    success: false,
                    message: "New password and confirm password must match."
                });
            }

            if (newPassword.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: "Password must be at least 6 characters long."
                });
            }

            const [users] = await db.execute(
                "SELECT id FROM users WHERE email = ?",
                [cleanEmail]
            );

            if (users.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "No account found with this email address."
                });
            }

            const hashedPassword = await bcrypt.hash(newPassword, 10);
            await db.execute("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, users[0].id]);

            return res.json({
                success: true,
                message: "Password updated successfully! Please sign in with your new password."
            });
        }

        // Otherwise validate email exists
        if (!email || !email.includes("@")) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid email address."
            });
        }

        const cleanEmail = email.trim().toLowerCase();
        const [users] = await db.execute("SELECT id FROM users WHERE email = ?", [cleanEmail]);
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No account found with this email address."
            });
        }

        return res.json({
            success: true,
            message: "Account verified. Please set your new password."
        });
    } catch (error) {
        console.error("Forgot password alias error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to process request at this time."
        });
    }
});

// ==========================================
// ROLE TEST ROUTES
// ==========================================
router.get(
    "/teacher-test",
    verifyToken,
    requireRole("teacher"),
    (req, res) => {
        res.json({
            success: true,
            message: "Welcome Teacher!",
            user: req.user
        });
    }
);

router.get(
    "/student-test",
    verifyToken,
    requireRole("student"),
    (req, res) => {
        res.json({
            success: true,
            message: "Welcome Student!",
            user: req.user
        });
    }
);

// ==========================================
// DELETE ACCOUNT
// ==========================================
router.delete(
    "/delete-account",
    verifyToken,
    async (req, res) => {
        try {
            const userId = req.user.id;

            const [result] = await db.execute(
                "DELETE FROM users WHERE id = ?",
                [userId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    message: "User account not found."
                });
            }

            res.json({
                success: true,
                message: "Account deleted successfully."
            });
        } catch (error) {
            console.error("DELETE ACCOUNT ERROR:", error);
            res.status(500).json({
                success: false,
                message: "Unable to delete account."
            });
        }
    }
);

module.exports = router;
