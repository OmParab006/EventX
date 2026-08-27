const express = require("express");
const router = express.Router();
const db = require("../db");
const { verifyToken, requireRole } = require("../middleware/authMiddleware");

// ==================================================
// STUDENT REGISTER FOR EVENT
// ==================================================
router.post("/", verifyToken, requireRole("student"), async (req, res) => {
    try {
        const { event_id } = req.body;
        const student_id = req.user.id;

        if (!event_id) {
            return res.status(400).json({
                success: false,
                message: "Event ID is required."
            });
        }

        // Check event exists
        const [events] = await db.execute("SELECT * FROM events WHERE id = ?", [event_id]);
        if (events.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Event not found."
            });
        }

        const event = events[0];

        // Check participant capacity
        const [countResult] = await db.execute(
            "SELECT COUNT(*) AS total FROM registrations WHERE event_id = ? AND registration_status != 'CANCELLED'",
            [event_id]
        );

        const totalParticipants = Number(countResult[0].total || 0);
        if (event.max_participants && totalParticipants >= Number(event.max_participants)) {
            return res.status(400).json({
                success: false,
                message: "Event is fully booked. Maximum capacity reached."
            });
        }

        // Check if already actively registered
        const [existing] = await db.execute(
            `SELECT * FROM registrations 
             WHERE event_id = ? AND student_id = ? AND registration_status != 'CANCELLED'
             LIMIT 1`,
            [event_id, student_id]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                message: "You are already registered for this event."
            });
        }

        // Check if previously cancelled registration exists
        const [cancelledReg] = await db.execute(
            `SELECT * FROM registrations 
             WHERE event_id = ? AND student_id = ? AND registration_status = 'CANCELLED'
             LIMIT 1`,
            [event_id, student_id]
        );

        const isFree = Number(event.fee || 0) === 0;
        let registrationId;

        if (isFree) {
            // Free event -> Instant Confirmation
            if (cancelledReg.length > 0) {
                registrationId = cancelledReg[0].id;
                await db.execute(
                    `UPDATE registrations 
                     SET registration_status = 'CONFIRMED', payment_status = 'NOT_REQUIRED', registered_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [registrationId]
                );
            } else {
                const [result] = await db.execute(
                    `INSERT INTO registrations (student_id, event_id, registration_status, payment_status)
                     VALUES (?, ?, 'CONFIRMED', 'NOT_REQUIRED')`,
                    [student_id, event_id]
                );
                registrationId = result.insertId;
            }

            return res.status(201).json({
                success: true,
                message: "Successfully registered for " + event.title + "!",
                registration_id: registrationId,
                payment_required: false,
                status: "CONFIRMED"
            });
        } else {
            // Paid event -> Pending Payment
            if (cancelledReg.length > 0) {
                registrationId = cancelledReg[0].id;
                await db.execute(
                    `UPDATE registrations 
                     SET registration_status = 'PENDING_PAYMENT', payment_status = 'PENDING', registered_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [registrationId]
                );
            } else {
                const [result] = await db.execute(
                    `INSERT INTO registrations (student_id, event_id, registration_status, payment_status)
                     VALUES (?, ?, 'PENDING_PAYMENT', 'PENDING')`,
                    [student_id, event_id]
                );
                registrationId = result.insertId;
            }

            return res.status(201).json({
                success: true,
                message: "Registration recorded. Please complete payment to confirm your seat.",
                registration_id: registrationId,
                payment_required: true,
                amount: Number(event.fee),
                status: "PENDING_PAYMENT"
            });
        }
    } catch (error) {
        console.error("REGISTRATION ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to process registration.",
            error: error.message
        });
    }
});

// ==================================================
// GET MY REGISTRATIONS (Student's Booked Events & Tickets)
// ==================================================
router.get("/my", verifyToken, requireRole("student"), async (req, res) => {
    try {
        const student_id = req.user.id;

        const [registrations] = await db.execute(
            `SELECT 
                r.id AS registration_id,
                r.event_id,
                r.student_id,
                r.registration_status,
                r.payment_status,
                r.registered_at,
                e.title,
                e.category,
                e.description,
                e.venue,
                e.event_date,
                e.fee,
                p.transaction_id,
                p.razorpay_order_id,
                p.paid_at
             FROM registrations r
             INNER JOIN events e ON r.event_id = e.id
             LEFT JOIN payments p ON r.id = p.registration_id AND p.payment_status = 'PAID'
             WHERE r.student_id = ? AND r.registration_status != 'CANCELLED'
             ORDER BY e.event_date ASC`,
            [student_id]
        );

        res.json({
            success: true,
            count: registrations.length,
            registrations: registrations.map(r => ({
                ...r,
                fee: Number(r.fee || 0),
                category: r.category || "Technical"
            }))
        });
    } catch (error) {
        console.error("GET REGISTRATIONS ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch your registrations.",
            error: error.message
        });
    }
});

// ==================================================
// CANCEL REGISTRATION / UNREGISTER
// ==================================================
router.delete("/:event_id", verifyToken, requireRole("student"), async (req, res) => {
    try {
        const event_id = req.params.event_id;
        const student_id = req.user.id;

        const [registrations] = await db.execute(
            `SELECT id FROM registrations 
             WHERE event_id = ? AND student_id = ? AND registration_status != 'CANCELLED'
             LIMIT 1`,
            [event_id, student_id]
        );

        if (registrations.length === 0) {
            return res.status(404).json({
                success: false,
                message: "You do not have an active registration for this event."
            });
        }

        await db.execute(
            "UPDATE registrations SET registration_status = 'CANCELLED' WHERE id = ?",
            [registrations[0].id]
        );

        res.json({
            success: true,
            message: "Registration cancelled successfully. Your seat has been released."
        });
    } catch (error) {
        console.error("CANCEL REGISTRATION ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to cancel registration.",
            error: error.message
        });
    }
});

module.exports = router;