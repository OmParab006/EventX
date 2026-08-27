const express = require("express");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const router = express.Router();
const db = require("../db");
const { verifyToken, requireRole } = require("../middleware/authMiddleware");

// Razorpay Instance
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    try {
        razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });
    } catch (e) {
        console.log("Razorpay init error:", e.message);
    }
}

// ==================================================
// CREATE RAZORPAY ORDER
// ==================================================
router.post("/create-order", verifyToken, requireRole("student"), async (req, res) => {
    try {
        const { registration_id } = req.body;

        if (!registration_id) {
            return res.status(400).json({
                success: false,
                message: "Registration ID is required."
            });
        }

        const [rows] = await db.execute(
            `SELECT r.id AS registration_id, r.student_id, r.event_id, r.registration_status, r.payment_status, e.title, e.fee
             FROM registrations r
             JOIN events e ON r.event_id = e.id
             WHERE r.id = ?`,
            [registration_id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Registration not found."
            });
        }

        const registration = rows[0];

        if (Number(registration.student_id) !== Number(req.user.id)) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized access to this registration."
            });
        }

        if (registration.payment_status === "PAID") {
            return res.status(400).json({
                success: false,
                message: "Payment has already been completed for this registration."
            });
        }

        const amount = Number(registration.fee);
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: "This event is free and does not require payment."
            });
        }

        const amountInPaise = Math.round(amount * 100);

        if (!razorpay) {
            return res.status(500).json({
                success: false,
                message: "Payment gateway credentials not configured. Use Test Pay mode."
            });
        }

        const order = await razorpay.orders.create({
            amount: amountInPaise,
            currency: "INR",
            receipt: `reg_${registration_id}_${Date.now()}`.substring(0, 40),
            notes: {
                registration_id: String(registration_id),
                student_id: String(req.user.id),
                event_title: registration.title
            }
        });

        // Insert pending payment record
        await db.execute(
            `INSERT INTO payments (registration_id, amount, payment_status, payment_gateway, razorpay_order_id)
             VALUES (?, ?, 'PENDING', 'RAZORPAY', ?)`,
            [registration_id, amount, order.id]
        );

        res.json({
            success: true,
            message: "Razorpay order created successfully.",
            order: {
                id: order.id,
                amount: order.amount,
                currency: order.currency
            },
            registration_id,
            event_title: registration.title,
            key_id: process.env.RAZORPAY_KEY_ID
        });
    } catch (error) {
        console.error("CREATE ORDER ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Failed to initialize payment gateway order.",
            error: error.message
        });
    }
});

// ==================================================
// VERIFY RAZORPAY PAYMENT
// ==================================================
router.post("/verify", verifyToken, requireRole("student"), async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, registration_id } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !registration_id) {
            return res.status(400).json({
                success: false,
                message: "Incomplete payment verification payload."
            });
        }

        const [payments] = await db.execute(
            `SELECT p.id, p.registration_id, r.student_id
             FROM payments p
             JOIN registrations r ON p.registration_id = r.id
             WHERE p.registration_id = ? AND p.razorpay_order_id = ?`,
            [registration_id, razorpay_order_id]
        );

        if (payments.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Payment order record not found."
            });
        }

        // Verify cryptographic signature
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "fvU7SaJIehnMdGa3Yz8OrhS7")
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment signature verification failed."
            });
        }

        // Update payment to PAID
        await db.execute(
            `UPDATE payments 
             SET payment_status = 'PAID', transaction_id = ?, paid_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [razorpay_payment_id, payments[0].id]
        );

        // Update registration to CONFIRMED
        await db.execute(
            `UPDATE registrations 
             SET registration_status = 'CONFIRMED', payment_status = 'PAID'
             WHERE id = ?`,
            [registration_id]
        );

        res.json({
            success: true,
            message: "Payment verified successfully! Your event registration is confirmed.",
            registration_id,
            transaction_id: razorpay_payment_id
        });
    } catch (error) {
        console.error("PAYMENT VERIFY ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Payment verification failed.",
            error: error.message
        });
    }
});

// ==================================================
// TEST PAYMENT SIMULATOR (Guaranteed 100% Viva/Demo Backup)
// ==================================================
router.post("/test-pay", verifyToken, requireRole("student"), async (req, res) => {
    try {
        const { registration_id, method } = req.body;

        if (!registration_id) {
            return res.status(400).json({
                success: false,
                message: "Registration ID is required."
            });
        }

        const [rows] = await db.execute(
            `SELECT r.id, r.student_id, r.event_id, r.payment_status, e.title, e.fee
             FROM registrations r
             JOIN events e ON r.event_id = e.id
             WHERE r.id = ?`,
            [registration_id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Registration not found."
            });
        }

        const reg = rows[0];
        if (Number(reg.student_id) !== Number(req.user.id)) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized."
            });
        }

        const mockTxnId = `TXN_TEST_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
        const mockOrderId = `order_sim_${Date.now()}`;

        // Insert payment record
        await db.execute(
            `INSERT INTO payments (registration_id, amount, payment_status, payment_gateway, razorpay_order_id, transaction_id, paid_at)
             VALUES (?, ?, 'PAID', ?, ?, ?, CURRENT_TIMESTAMP)`,
            [registration_id, Number(reg.fee), method || "UPI_SIMULATOR", mockOrderId, mockTxnId]
        );

        // Update registration
        await db.execute(
            `UPDATE registrations 
             SET registration_status = 'CONFIRMED', payment_status = 'PAID'
             WHERE id = ?`,
            [registration_id]
        );

        res.json({
            success: true,
            message: "Payment simulated successfully! Registration is now CONFIRMED.",
            registration_id,
            transaction_id: mockTxnId,
            event_title: reg.title,
            amount: Number(reg.fee)
        });
    } catch (error) {
        console.error("TEST PAY ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Test payment failed.",
            error: error.message
        });
    }
});

module.exports = router;