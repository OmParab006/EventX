const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const db = require("../db");
const { verifyToken, requireRole } = require("../middleware/authMiddleware");
const { sendPasswordResetEmail } = require("../utils/emailService");

const router = express.Router();

// In-memory rate limiting map for forgot-password requests
// Format: { [email]: { lastRequestedAt: timestamp, requestCount: number, windowStart: timestamp } }
const resetRateLimits = new Map();

function checkResetRateLimit(email) {
    const now = Date.now();
    const cleanEmail = email.toLowerCase().trim();
    const entry = resetRateLimits.get(cleanEmail);

    if (!entry) {
        resetRateLimits.set(cleanEmail, {
            lastRequestedAt: now,
            requestCount: 1,
            windowStart: now
        });
        return { allowed: true };
    }

    // Reset window after 15 minutes
    if (now - entry.windowStart > 15 * 60 * 1000) {
        resetRateLimits.set(cleanEmail, {
            lastRequestedAt: now,
            requestCount: 1,
            windowStart: now
        });
        return { allowed: true };
    }

    // Minimum interval between requests: 30 seconds
    if (now - entry.lastRequestedAt < 30 * 1000) {
        const waitSeconds = Math.ceil((30 * 1000 - (now - entry.lastRequestedAt)) / 1000);
        return {
            allowed: false,
            message: `Please wait ${waitSeconds} seconds before requesting another code.`
        };
    }

    // Maximum 5 requests per 15 minutes
    if (entry.requestCount >= 5) {
        return {
            allowed: false,
            message: "Too many password reset requests. Please try again in 15 minutes."
        };
    }

    entry.requestCount += 1;
    entry.lastRequestedAt = now;
    return { allowed: true };
}

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
// FORGOT PASSWORD: STEP 1 (REQUEST OTP)
// ==========================================
router.post("/forgot-password", async (req, res) => {
    try {
        const { email } = req.body;

        if (!email || typeof email !== "string" || !email.includes("@")) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid email address."
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        // Check rate limiting
        const rateCheck = checkResetRateLimit(cleanEmail);
        if (!rateCheck.allowed) {
            return res.status(429).json({
                success: false,
                message: rateCheck.message
            });
        }

        // Generic security response message
        const genericSuccessMessage = "If an account exists with this email, a verification code has been sent.";

        // Find user by email
        const [users] = await db.execute(
            "SELECT id, name, email FROM users WHERE email = ?",
            [cleanEmail]
        );

        if (users.length === 0) {
            // Return generic response without revealing user existence
            return res.json({
                success: true,
                message: genericSuccessMessage
            });
        }

        const user = users[0];

        // Invalidate any previous unused tokens for this user
        await db.execute(
            "UPDATE password_reset_tokens SET is_used = 1 WHERE user_id = ? AND is_used = 0",
            [user.id]
        );

        // Generate cryptographically secure 6-digit random OTP
        const otpCode = crypto.randomInt(100000, 999999).toString();

        // Hash OTP with SHA-256
        const otpHash = crypto.createHash("sha256").update(otpCode).digest("hex");

        // Expiration: 10 minutes from now
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // Save token in database
        await db.execute(
            `INSERT INTO password_reset_tokens
             (user_id, email, otp_hash, attempts, is_used, expires_at)
             VALUES (?, ?, ?, 0, 0, ?)`,
            [user.id, cleanEmail, otpHash, expiresAt]
        );

        // Send email with OTP
        await sendPasswordResetEmail(cleanEmail, otpCode, user.name);

        return res.json({
            success: true,
            message: genericSuccessMessage
        });
    } catch (error) {
        console.error("Forgot password error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to process password reset request at this time."
        });
    }
});

// ==========================================
// FORGOT PASSWORD: STEP 2 (VERIFY OTP)
// ==========================================
router.post("/verify-reset-otp", async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({
                success: false,
                message: "Email and verification code are required."
            });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanOtp = otp.toString().trim();

        if (cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid 6-digit verification code."
            });
        }

        // Find active, unexpired token record
        const [tokens] = await db.execute(
            `SELECT * FROM password_reset_tokens
             WHERE email = ? AND is_used = 0 AND expires_at > NOW()
             ORDER BY id DESC
             LIMIT 1`,
            [cleanEmail]
        );

        if (tokens.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Verification code has expired or is invalid. Please request a new one."
            });
        }

        const tokenRecord = tokens[0];

        // Check max attempts
        if (tokenRecord.attempts >= 5) {
            await db.execute(
                "UPDATE password_reset_tokens SET is_used = 1 WHERE id = ?",
                [tokenRecord.id]
            );
            return res.status(429).json({
                success: false,
                message: "Too many failed attempts. Please request a new verification code."
            });
        }

        // Check OTP hash
        const computedOtpHash = crypto.createHash("sha256").update(cleanOtp).digest("hex");

        if (computedOtpHash !== tokenRecord.otp_hash) {
            await db.execute(
                "UPDATE password_reset_tokens SET attempts = attempts + 1 WHERE id = ?",
                [tokenRecord.id]
            );
            return res.status(400).json({
                success: false,
                message: "Incorrect verification code. Please try again."
            });
        }

        // OTP is correct -> Generate secure temporary reset token
        const resetToken = crypto.randomBytes(32).toString("hex");
        const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

        await db.execute(
            "UPDATE password_reset_tokens SET reset_token_hash = ?, attempts = 0 WHERE id = ?",
            [resetTokenHash, tokenRecord.id]
        );

        res.json({
            success: true,
            message: "Verification code confirmed.",
            resetToken
        });
    } catch (error) {
        console.error("Verify OTP error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to verify code at this time."
        });
    }
});

// ==========================================
// FORGOT PASSWORD: STEP 3 (RESET PASSWORD)
// ==========================================
router.post("/reset-password", async (req, res) => {
    try {
        const { email, resetToken, newPassword, confirmPassword } = req.body;

        if (!email || !resetToken || !newPassword || !confirmPassword) {
            return res.status(400).json({
                success: false,
                message: "All fields are required."
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: "Passwords do not match."
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters long."
            });
        }

        // Hash the provided resetToken to check against DB
        const resetTokenHash = crypto.createHash("sha256").update(resetToken.trim()).digest("hex");

        const [tokens] = await db.execute(
            `SELECT * FROM password_reset_tokens
             WHERE email = ? AND reset_token_hash = ? AND is_used = 0 AND expires_at > NOW()
             ORDER BY id DESC
             LIMIT 1`,
            [cleanEmail, resetTokenHash]
        );

        if (tokens.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Reset session has expired or is invalid. Please restart the forgot password process."
            });
        }

        const tokenRecord = tokens[0];

        // Hash the new password with bcrypt
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password in users table
        await db.execute(
            "UPDATE users SET password = ? WHERE id = ?",
            [hashedPassword, tokenRecord.user_id]
        );

        // Invalidate token record so it cannot be reused
        await db.execute(
            "UPDATE password_reset_tokens SET is_used = 1 WHERE id = ?",
            [tokenRecord.id]
        );

        res.json({
            success: true,
            message: "Password reset successfully. Please sign in with your new password."
        });
    } catch (error) {
        console.error("Reset password error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to reset password. Please try again."
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
