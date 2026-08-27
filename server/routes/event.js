const express = require("express");
const router = express.Router();
const db = require("../db");
const { verifyToken, requireRole } = require("../middleware/authMiddleware");

// ==================================================
// GET ALL EVENTS (Public with Search & Category Filters)
// ==================================================
router.get("/", async (req, res) => {
    try {
        const { search, category, fee_type } = req.query;

        let query = `
            SELECT 
                e.id,
                e.title,
                e.category,
                e.description,
                e.venue,
                e.event_date,
                e.max_participants,
                e.fee,
                e.created_by,
                e.created_at,
                u.name AS organizer_name,
                COUNT(CASE WHEN r.registration_status != 'CANCELLED' THEN r.id END) AS registered_count
            FROM events e
            LEFT JOIN users u ON e.created_by = u.id
            LEFT JOIN registrations r ON e.id = r.event_id
            WHERE 1=1
        `;

        const params = [];

        if (search && search.trim()) {
            query += ` AND (e.title LIKE ? OR e.description LIKE ? OR e.venue LIKE ?)`;
            const s = `%${search.trim()}%`;
            params.push(s, s, s);
        }

        if (category && category !== "all" && category.trim()) {
            query += ` AND LOWER(e.category) = LOWER(?)`;
            params.push(category.trim());
        }

        if (fee_type === "free") {
            query += ` AND e.fee = 0`;
        } else if (fee_type === "paid") {
            query += ` AND e.fee > 0`;
        }

        query += `
            GROUP BY e.id, u.name
            ORDER BY e.event_date ASC
        `;

        const [events] = await db.execute(query, params);

        // Format events with available seats
        const formattedEvents = events.map(e => {
            const registered = Number(e.registered_count || 0);
            const max = Number(e.max_participants || 100);
            const available = Math.max(0, max - registered);
            return {
                ...e,
                fee: Number(e.fee || 0),
                registered_count: registered,
                available_seats: available,
                is_full: registered >= max,
                category: e.category || "Technical"
            };
        });

        res.json({
            success: true,
            total: formattedEvents.length,
            events: formattedEvents
        });
    } catch (error) {
        console.error("GET EVENTS ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch events.",
            error: error.message
        });
    }
});

// ==================================================
// GET SINGLE EVENT BY ID
// ==================================================
router.get("/:id", async (req, res) => {
    try {
        const [events] = await db.execute(
            `SELECT 
                e.*,
                u.name AS organizer_name,
                COUNT(CASE WHEN r.registration_status != 'CANCELLED' THEN r.id END) AS registered_count
             FROM events e
             LEFT JOIN users u ON e.created_by = u.id
             LEFT JOIN registrations r ON e.id = r.event_id
             WHERE e.id = ?
             GROUP BY e.id, u.name`,
            [req.params.id]
        );

        if (events.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Event not found."
            });
        }

        const ev = events[0];
        const registered = Number(ev.registered_count || 0);
        const max = Number(ev.max_participants || 100);

        res.json({
            success: true,
            event: {
                ...ev,
                fee: Number(ev.fee || 0),
                registered_count: registered,
                available_seats: Math.max(0, max - registered),
                is_full: registered >= max
            }
        });
    } catch (error) {
        console.error("GET EVENT ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch event.",
            error: error.message
        });
    }
});

// ==================================================
// CREATE EVENT (Admin / Faculty)
// ==================================================
router.post("/", verifyToken, requireRole(["admin", "teacher"]), async (req, res) => {
    try {
        const { title, category, description, venue, event_date, max_participants, fee } = req.body;

        if (!title || !venue || !event_date || !max_participants) {
            return res.status(400).json({
                success: false,
                message: "Title, venue, event date, and maximum participants are required."
            });
        }

        const [result] = await db.execute(
            `INSERT INTO events 
             (title, category, description, venue, event_date, max_participants, fee, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                title.trim(),
                category || "Technical",
                description ? description.trim() : null,
                venue.trim(),
                event_date,
                Number(max_participants),
                Number(fee || 0),
                req.user.id
            ]
        );

        res.status(201).json({
            success: true,
            message: "Event created successfully.",
            event_id: result.insertId
        });
    } catch (error) {
        console.error("CREATE EVENT ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to create event.",
            error: error.message
        });
    }
});

// ==================================================
// UPDATE EVENT (Admin / Creator)
// ==================================================
router.put("/:id", verifyToken, requireRole(["admin", "teacher"]), async (req, res) => {
    try {
        const { title, category, description, venue, event_date, max_participants, fee } = req.body;

        const [result] = await db.execute(
            `UPDATE events
             SET title = ?, category = ?, description = ?, venue = ?, event_date = ?, max_participants = ?, fee = ?
             WHERE id = ?`,
            [
                title.trim(),
                category || "Technical",
                description ? description.trim() : null,
                venue.trim(),
                event_date,
                Number(max_participants),
                Number(fee || 0),
                req.params.id
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Event not found."
            });
        }

        res.json({
            success: true,
            message: "Event updated successfully."
        });
    } catch (error) {
        console.error("UPDATE EVENT ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to update event.",
            error: error.message
        });
    }
});

// ==================================================
// DELETE EVENT (Admin / Creator)
// ==================================================
router.delete("/:id", verifyToken, requireRole(["admin", "teacher"]), async (req, res) => {
    try {
        const [result] = await db.execute("DELETE FROM events WHERE id = ?", [req.params.id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Event not found."
            });
        }

        res.json({
            success: true,
            message: "Event deleted successfully."
        });
    } catch (error) {
        console.error("DELETE EVENT ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to delete event.",
            error: error.message
        });
    }
});

// ==================================================
// GET EVENT PARTICIPANTS (Attendance list with payment info)
// ==================================================
router.get("/:id/participants", verifyToken, requireRole(["admin", "teacher"]), async (req, res) => {
    try {
        const eventId = req.params.id;

        const [events] = await db.execute(
            "SELECT id, title, category, venue, event_date, max_participants, fee FROM events WHERE id = ?",
            [eventId]
        );

        if (events.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Event not found."
            });
        }

        const [participants] = await db.execute(
            `SELECT 
                r.id AS registration_id,
                r.student_id,
                r.registration_status,
                r.payment_status,
                r.registered_at,
                u.name AS student_name,
                u.email AS student_email,
                p.transaction_id,
                p.razorpay_order_id,
                p.paid_at
             FROM registrations r
             INNER JOIN users u ON r.student_id = u.id
             LEFT JOIN payments p ON r.id = p.registration_id AND p.payment_status = 'PAID'
             WHERE r.event_id = ? AND r.registration_status != 'CANCELLED'
             ORDER BY r.registered_at DESC`,
            [eventId]
        );

        res.json({
            success: true,
            event: events[0],
            total_participants: participants.length,
            participants
        });
    } catch (error) {
        console.error("GET PARTICIPANTS ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch participants.",
            error: error.message
        });
    }
});

module.exports = router;