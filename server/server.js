const express = require("express");
const dotenv = require("dotenv");
const path = require("path");
const cors = require("cors");

// Load Environment Variables — check project root first, then CWD
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config(); // fallback for when running from project root

const db = require("./db");
const initDatabase = require("./initDb");

// Routes
const authRoutes = require("./routes/auth");
const eventRoutes = require("./routes/event");
const registrationRoutes = require("./routes/registration");
const paymentRoutes = require("./routes/payment");
const adminRoutes = require("./routes/admin");

const app = express();

// ==========================================
// MIDDLEWARES
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, "../frontend")));

// ==========================================
// API ROUTES
// ==========================================
app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/registrations", registrationRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin", adminRoutes);

// ==========================================
// DATABASE HEALTH CHECK
// ==========================================
app.get("/test-db", async (req, res) => {
    try {
        const [result] = await db.execute("SELECT 1 AS test");
        res.json({
            success: true,
            message: "MySQL connection successful.",
            result
        });
    } catch (error) {
        console.error("DATABASE ERROR:", error);
        res.status(500).json({
            success: false,
            message: "MySQL connection failed.",
            error: error.message
        });
    }
});

// ==========================================
// PAGE ROUTING & FALLBACKS
// ==========================================
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

app.get("/dashboard", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/dashboard.html"));
});

app.get("/teacher-dashboard", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/teacher-dashboard.html"));
});

app.get("/teacher-dashboard.html", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/teacher-dashboard.html"));
});

app.get("/admin", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/teacher-dashboard.html"));
});

app.get("/admin-dashboard.html", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/teacher-dashboard.html"));
});

// ==========================================
// GLOBAL ERROR HANDLER
// ==========================================
app.use((err, req, res, next) => {
    console.error("GLOBAL SERVER ERROR:", err);
    res.status(500).json({
        success: false,
        message: "Internal server error.",
        error: err.message
    });
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
    console.log(`==========================================`);
    console.log(`  EventX Server running on http://localhost:${PORT}`);
    console.log(`==========================================`);
    
    // Auto-verify DB initialization on startup
    await initDatabase();
});