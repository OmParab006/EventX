require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("./db");

async function seedDatabase() {
    console.log("==========================================");
    console.log("  EVENTX DATABASE INITIALIZATION & SEED  ");
    console.log("==========================================");

    try {
        // 1. Ensure category column exists in events table
        try {
            const [columns] = await db.execute("DESCRIBE events");
            const hasCategory = columns.some(col => col.Field === "category");
            if (!hasCategory) {
                console.log("Adding 'category' column to events table...");
                await db.execute("ALTER TABLE events ADD COLUMN category VARCHAR(50) DEFAULT 'Technical' AFTER description");
                console.log("✓ 'category' column added successfully.");
            } else {
                console.log("✓ 'category' column already exists in events.");
            }
        } catch (e) {
            console.log("Note on events schema check:", e.message);
        }

        // 2. Hash passwords
        const studentPassword = await bcrypt.hash("student123", 10);
        const adminPassword = await bcrypt.hash("admin123", 10);

        // 3. Upsert Demo Accounts
        // Admin / Faculty Demo
        const [adminCheck] = await db.execute("SELECT id FROM users WHERE email = ?", ["admin@eventx.com"]);
        let adminId;
        if (adminCheck.length === 0) {
            const [res] = await db.execute(
                "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
                ["Prof. Rajesh Sharma (Faculty Admin)", "admin@eventx.com", adminPassword, "admin"]
            );
            adminId = res.insertId;
            console.log("✓ Created Admin / Faculty account: admin@eventx.com / admin123 (ID: " + adminId + ")");
        } else {
            adminId = adminCheck[0].id;
            await db.execute("UPDATE users SET password = ?, role = 'admin' WHERE id = ?", [adminPassword, adminId]);
            console.log("✓ Updated Admin / Faculty account: admin@eventx.com / admin123 (ID: " + adminId + ")");
        }

        // Also update teacher accounts to have admin/faculty access if any
        await db.execute("UPDATE users SET role = 'admin' WHERE role = 'teacher'");

        // Student Demo 1
        const [studentCheck] = await db.execute("SELECT id FROM users WHERE email = ?", ["student@test.com"]);
        let studentId;
        if (studentCheck.length === 0) {
            const [res] = await db.execute(
                "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
                ["Aarav Patel", "student@test.com", studentPassword, "student"]
            );
            studentId = res.insertId;
            console.log("✓ Created Student account: student@test.com / student123 (ID: " + studentId + ")");
        } else {
            studentId = studentCheck[0].id;
            await db.execute("UPDATE users SET password = ?, role = 'student' WHERE id = ?", [studentPassword, studentId]);
            console.log("✓ Updated Student account: student@test.com / student123 (ID: " + studentId + ")");
        }

        // Student Demo 2
        const [student2Check] = await db.execute("SELECT id FROM users WHERE email = ?", ["yashu@gmail.com"]);
        let student2Id;
        if (student2Check.length === 0) {
            const [res] = await db.execute(
                "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
                ["Yashashree Patil", "yashu@gmail.com", studentPassword, "student"]
            );
            student2Id = res.insertId;
        } else {
            student2Id = student2Check[0].id;
            await db.execute("UPDATE users SET password = ?, role = 'student' WHERE id = ?", [studentPassword, student2Id]);
        }

        // 4. Seed Realistic Sample Events
        const sampleEvents = [
            {
                title: "CodeStorm 2026: 24-Hour National Hackathon",
                category: "Technical",
                description: "The biggest annual hackathon of our college! Build innovative solutions in AI, Web3, and IoT. Cash prizes worth ₹50,000 + certificate for all.",
                venue: "Advanced Computing Lab & Main Auditorium",
                event_date: "2026-09-15 09:00:00",
                max_participants: 120,
                fee: 150.00
            },
            {
                title: "AI & Generative Deep Learning Masterclass",
                category: "Workshop",
                description: "Hands-on industrial workshop by Google Developer Experts. Learn LLMs, LangChain, RAG architecture, and deploying intelligent agentic workflows.",
                venue: "Seminar Hall B (Einstein Block)",
                event_date: "2026-09-22 10:30:00",
                max_participants: 80,
                fee: 0.00
            },
            {
                title: "Tarang 2026: Annual College Cultural Fest",
                category: "Cultural",
                description: "Experience the vibrant spirit of music, dance, drama, and fashion show. Celebrity night, DJ performances, food stalls, and battle of the bands!",
                venue: "College Open Air Amphitheatre",
                event_date: "2026-10-05 16:00:00",
                max_participants: 500,
                fee: 99.00
            },
            {
                title: "Inter-College Sports Championship 2026",
                category: "Sports",
                description: "Annual sports tournament featuring Cricket, Football, Basketball, Badminton, and Athletics. Trophies, medals, and certificates for all winners.",
                venue: "Main Sports Complex & College Ground",
                event_date: "2026-10-18 08:00:00",
                max_participants: 200,
                fee: 50.00
            },
            {
                title: "CyberShield: Ethical Hacking & Security Bootcamp",
                category: "Workshop",
                description: "Live demonstration of penetration testing, network sniffing, bug bounty hunting techniques, and OWASP Top 10 vulnerabilities defense.",
                venue: "Cyber Security Lab (Room 304)",
                event_date: "2026-11-02 11:00:00",
                max_participants: 60,
                fee: 0.00
            },
            {
                title: "UI/UX & Product Design Sprint with Figma",
                category: "Technical",
                description: "Master modern product design principles, design systems, micro-interactions, responsive layouts, and interactive mobile prototyping in Figma.",
                venue: "Design Studio (Room 201)",
                event_date: "2026-11-12 14:00:00",
                max_participants: 75,
                fee: 0.00
            }
        ];

        // Check if events exist, if not or count is low, add them
        const [existingEvents] = await db.execute("SELECT COUNT(*) as count FROM events");
        if (existingEvents[0].count < 4) {
            console.log("Seeding sample events...");
            for (const ev of sampleEvents) {
                await db.execute(
                    `INSERT INTO events (title, category, description, venue, event_date, max_participants, fee, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [ev.title, ev.category, ev.description, ev.venue, ev.event_date, ev.max_participants, ev.fee, adminId]
                );
            }
            console.log("✓ Added sample events.");
        } else {
            // Update existing events with nice categories
            await db.execute("UPDATE events SET category = 'Technical' WHERE category IS NULL OR category = '' OR category = 'General'");
            console.log("✓ Existing events categorized.");
        }

        // 5. Seed a sample registration for Student 1 so "My Registrations" shows real data
        const [allEvs] = await db.execute("SELECT id, fee FROM events LIMIT 2");
        if (allEvs.length > 0) {
            const freeEv = allEvs.find(e => Number(e.fee) === 0) || allEvs[0];
            const [regCheck] = await db.execute(
                "SELECT id FROM registrations WHERE student_id = ? AND event_id = ?",
                [studentId, freeEv.id]
            );
            if (regCheck.length === 0) {
                await db.execute(
                    `INSERT INTO registrations (student_id, event_id, registration_status, payment_status)
                     VALUES (?, ?, 'CONFIRMED', 'NOT_REQUIRED')`,
                    [studentId, freeEv.id]
                );
                console.log("✓ Added sample confirmed registration for student.");
            }
        }

        console.log("==========================================");
        console.log("✓ Database successfully seeded & ready!");
        console.log("==========================================");
    } catch (err) {
        console.error("Database seeding error:", err);
    }
}

if (require.main === module) {
    seedDatabase().then(() => process.exit(0));
}

module.exports = seedDatabase;
