const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("../db");

const { verifyToken, requireRole } =
    require("../middleware/authMiddleware");

const router = express.Router();

router.get("/test", (req, res) => {
    res.json({
        success: true,
        message: "Authentication route is working!"
    });
});

router.post("/register", async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        if (!name || !email || !password || !role) {
            return res.status(400).json({
                success: false,
                message: "All fields are required."
            });
        }

        if (role !== "student" && role !== "teacher") {
            return res.status(400).json({
                success: false,
                message: "Invalid role."
            });
        }

        const [existing] = await db.execute(
            "SELECT id FROM users WHERE email = ?",
            [email]
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
            [name, email, hashedPassword, role]
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

router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required."
            });
        }

        const [users] = await db.execute(
            "SELECT * FROM users WHERE email = ?",
            [email]
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

        // Admin is now treated as Teacher.
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
