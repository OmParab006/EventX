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
    } catch (error) {
        console.error("Database initialization warning:", error.message);
    }
}

module.exports = initDatabase;

if (require.main === module) {
    initDatabase().then(() => process.exit(0)).catch(() => process.exit(1));
}
