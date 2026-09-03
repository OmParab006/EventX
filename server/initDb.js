require("dotenv").config();
const db = require("./db");

async function initDatabase() {
    try {
        const createTableSql = `
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id INT NOT NULL AUTO_INCREMENT,
                user_id INT NOT NULL,
                email VARCHAR(150) NOT NULL,
                otp_hash VARCHAR(255) NOT NULL,
                reset_token_hash VARCHAR(255) DEFAULT NULL,
                attempts INT DEFAULT 0,
                is_used TINYINT(1) DEFAULT 0,
                expires_at DATETIME NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY user_id (user_id),
                KEY email (email),
                CONSTRAINT fk_prt_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
        `;

        await db.query(createTableSql);
        console.log("✓ Database initialized: password_reset_tokens table is ready.");

        // Check if last_login column exists on users table
        const [columns] = await db.query(
            `SELECT COLUMN_NAME 
             FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_login'`
        );

        if (columns.length === 0) {
            await db.query("ALTER TABLE users ADD COLUMN last_login DATETIME NULL DEFAULT NULL AFTER created_at");
            console.log("✓ Database migrated: Added 'last_login' column to users table.");
        } else {
            console.log("✓ Database check: 'last_login' column already exists in users table.");
        }
    } catch (error) {
        console.error("Database initialization warning:", error.message);
    }
}

module.exports = initDatabase;

if (require.main === module) {
    initDatabase().then(() => process.exit(0)).catch(() => process.exit(1));
}
