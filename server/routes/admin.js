const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { verifyToken, requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

// Enforce Admin / Faculty Role for all admin routes
router.use(verifyToken, requireRole(["admin", "teacher"]));

// ==================================================
// MASTER DASHBOARD KPI STATS & ANALYTICS
// ==================================================
router.get("/stats", async (req, res) => {
    try {
        const [[students]] = await db.execute("SELECT COUNT(*) AS total FROM users WHERE role = 'student'");
        const [[admins]] = await db.execute("SELECT COUNT(*) AS total FROM users WHERE role IN ('admin', 'teacher')");
        const [[events]] = await db.execute("SELECT COUNT(*) AS total FROM events");
        const [[registrations]] = await db.execute(
            "SELECT COUNT(*) AS total FROM registrations WHERE registration_status != 'CANCELLED'"
        );
        const [[revenue]] = await db.execute(
            "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_status = 'PAID'"
        );

        // Category breakdown
        const [categories] = await db.execute(
            `SELECT category, COUNT(*) as count 
             FROM events 
             GROUP BY category`
        );

        // Recent 5 registrations
        const [recentRegistrations] = await db.execute(
            `SELECT 
                r.id,
                r.registration_status,
                r.payment_status,
                r.registered_at,
                u.name AS student_name,
                u.email AS student_email,
                e.title AS event_title,
                e.fee
             FROM registrations r
             JOIN users u ON r.student_id = u.id
             JOIN events e ON r.event_id = e.id
             ORDER BY r.registered_at DESC
             LIMIT 5`
        );

        res.json({
            success: true,
            stats: {
                students: Number(students.total || 0),
                faculty: Number(admins.total || 0),
                events: Number(events.total || 0),
                registrations: Number(registrations.total || 0),
                revenue: Number(revenue.total || 0),
                categories: categories.map(c => ({ name: c.category || "Other", count: Number(c.count) })),
                recentRegistrations
            }
        });
    } catch (error) {
        console.error("ADMIN STATS ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch dashboard statistics.",
            error: error.message
        });
    }
});

// ==================================================
// ==================================================
// STUDENTS MANAGEMENT (Faculty / Organizer Protected)
// ==================================================
router.get("/students", async (req, res) => {
    try {
        const { search } = req.query;

        let query = `
            SELECT 
                u.id,
                u.name,
                u.email,
                u.role,
                u.created_at,
                u.last_login,
                COUNT(DISTINCT CASE WHEN r.registration_status != 'CANCELLED' THEN r.id END) AS registrations_count,
                COALESCE(SUM(CASE WHEN p.payment_status = 'PAID' THEN p.amount ELSE 0 END), 0) AS total_paid
            FROM users u
            LEFT JOIN registrations r ON u.id = r.student_id
            LEFT JOIN payments p ON r.id = p.registration_id
            WHERE u.role = 'student'
        `;

        const params = [];

        if (search && search.trim()) {
            const s = `%${search.trim()}%`;
            query += ` AND (u.id LIKE ? OR u.name LIKE ? OR u.email LIKE ?)`;
            params.push(s, s, s);
        }

        query += `
            GROUP BY u.id
            ORDER BY u.id DESC
        `;

        const [students] = await db.execute(query, params);

        res.json({
            success: true,
            total: students.length,
            students: students.map(st => ({
                ...st,
                registrations_count: Number(st.registrations_count || 0),
                total_paid: Number(st.total_paid || 0)
            }))
        });
    } catch (error) {
        console.error("ADMIN STUDENTS ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch student list.",
            error: error.message
        });
    }
});

// Delete student account (Faculty protected, strictly blocks deleting faculty/admin)
router.delete("/students/:id", async (req, res) => {
    try {
        const targetUserId = req.params.id;

        // Prevent self-deletion
        if (Number(targetUserId) === Number(req.user.id)) {
            return res.status(400).json({
                success: false,
                message: "You cannot delete your own account through student management."
            });
        }

        // Validate target user exists and is strictly a student
        const [targetUsers] = await db.execute(
            "SELECT id, name, email, role FROM users WHERE id = ?",
            [targetUserId]
        );

        if (targetUsers.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Student not found."
            });
        }

        const targetUser = targetUsers[0];

        // Security check: strictly block deleting teacher/admin accounts
        if (targetUser.role !== "student") {
            return res.status(403).json({
                success: false,
                message: "Security restriction: Only student accounts can be deleted through this endpoint."
            });
        }

        // Delete the student record (foreign keys cascade to registrations, payments, tokens)
        const [result] = await db.execute(
            "DELETE FROM users WHERE id = ? AND role = 'student'",
            [targetUserId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Student not found or already deleted."
            });
        }

        res.json({
            success: true,
            message: `Student '${targetUser.name}' (ID: ${targetUser.id}) has been deleted successfully.`
        });
    } catch (error) {
        console.error("ADMIN DELETE STUDENT ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to delete student account.",
            error: error.message
        });
    }
});

// ==================================================
// USERS MANAGEMENT
// ==================================================
router.get("/users", async (req, res) => {
    try {
        const [users] = await db.execute(
            `SELECT 
                u.id,
                u.name,
                u.email,
                u.role,
                u.created_at,
                u.last_login,
                COUNT(DISTINCT r.id) AS registrations_count,
                COUNT(DISTINCT e.id) AS events_created
             FROM users u
             LEFT JOIN registrations r ON u.id = r.student_id AND r.registration_status != 'CANCELLED'
             LEFT JOIN events e ON u.id = e.created_by
             GROUP BY u.id
             ORDER BY u.id DESC`
        );

        res.json({
            success: true,
            total: users.length,
            users
        });
    } catch (error) {
        console.error("ADMIN USERS ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch users.",
            error: error.message
        });
    }
});

// Admin creates user
router.post("/users", async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "Name, email, and password are required."
            });
        }

        const [existing] = await db.execute("SELECT id FROM users WHERE email = ?", [email.trim()]);
        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Email already registered."
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userRole = role === "admin" || role === "teacher" ? "admin" : "student";

        const [result] = await db.execute(
            "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
            [name.trim(), email.trim().toLowerCase(), hashedPassword, userRole]
        );

        res.status(201).json({
            success: true,
            message: "User created successfully.",
            userId: result.insertId
        });
    } catch (error) {
        console.error("ADMIN CREATE USER ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to create user.",
            error: error.message
        });
    }
});

// Admin updates user role
router.put("/users/:id/role", async (req, res) => {
    try {
        const { role } = req.body;
        const targetUserId = req.params.id;

        if (!role || (role !== "student" && role !== "admin" && role !== "teacher")) {
            return res.status(400).json({
                success: false,
                message: "Invalid role specified."
            });
        }

        const effectiveRole = role === "teacher" ? "admin" : role;

        await db.execute("UPDATE users SET role = ? WHERE id = ?", [effectiveRole, targetUserId]);

        res.json({
            success: true,
            message: "User role updated successfully."
        });
    } catch (error) {
        console.error("ADMIN UPDATE ROLE ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to update user role.",
            error: error.message
        });
    }
});

// Admin deletes user
router.delete("/users/:id", async (req, res) => {
    try {
        const targetUserId = req.params.id;

        if (Number(targetUserId) === Number(req.user.id)) {
            return res.status(400).json({
                success: false,
                message: "You cannot delete your own active admin account."
            });
        }

        const [result] = await db.execute("DELETE FROM users WHERE id = ?", [targetUserId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        res.json({
            success: true,
            message: "User deleted successfully."
        });
    } catch (error) {
        console.error("ADMIN DELETE USER ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to delete user.",
            error: error.message
        });
    }
});

// ==================================================
// ALL REGISTRATIONS MANAGEMENT
// ==================================================
router.get("/registrations", async (req, res) => {
    try {
        const [registrations] = await db.execute(
            `SELECT 
                r.id AS registration_id,
                r.registration_status,
                r.payment_status,
                r.registered_at,
                u.id AS student_id,
                u.name AS student_name,
                u.email AS student_email,
                e.id AS event_id,
                e.title AS event_title,
                e.category,
                e.event_date,
                e.venue,
                e.fee,
                p.transaction_id,
                p.razorpay_order_id,
                p.amount AS paid_amount,
                p.paid_at
             FROM registrations r
             INNER JOIN users u ON r.student_id = u.id
             INNER JOIN events e ON r.event_id = e.id
             LEFT JOIN payments p ON r.id = p.registration_id AND p.payment_status = 'PAID'
             ORDER BY r.registered_at DESC`
        );

        res.json({
            success: true,
            total: registrations.length,
            registrations
        });
    } catch (error) {
        console.error("ADMIN REGISTRATIONS ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch registrations.",
            error: error.message
        });
    }
});

// Admin cancels/revokes registration
router.delete("/registrations/:id", async (req, res) => {
    try {
        const regId = req.params.id;
        await db.execute("UPDATE registrations SET registration_status = 'CANCELLED' WHERE id = ?", [regId]);

        res.json({
            success: true,
            message: "Registration has been cancelled."
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to cancel registration."
        });
    }
});

// ==================================================
// ALL PAYMENTS MANAGEMENT
// ==================================================
router.get("/payments", async (req, res) => {
    try {
        const [payments] = await db.execute(
            `SELECT 
                p.id AS payment_id,
                p.registration_id,
                p.amount,
                p.payment_status,
                p.payment_gateway,
                p.razorpay_order_id,
                p.transaction_id,
                p.paid_at,
                p.created_at,
                u.name AS student_name,
                u.email AS student_email,
                e.title AS event_title
             FROM payments p
             INNER JOIN registrations r ON p.registration_id = r.id
             INNER JOIN users u ON r.student_id = u.id
             INNER JOIN events e ON r.event_id = e.id
             ORDER BY p.id DESC`
        );

        res.json({
            success: true,
            total: payments.length,
            payments
        });
    } catch (error) {
        console.error("ADMIN PAYMENTS ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch payments.",
            error: error.message
        });
    }
});

module.exports = router;