const nodemailer = require("nodemailer");

/**
 * Configure and return the SMTP Transporter
 */
function createTransporter() {
    const host = process.env.EMAIL_HOST;
    const port = Number(process.env.EMAIL_PORT) || 587;
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASSWORD;
    const secure = process.env.EMAIL_SECURE === "true" || port === 465;

    // Check if valid SMTP credentials exist
    if (!host || !user || !pass) {
        return null;
    }

    return nodemailer.createTransport({
        host,
        port,
        secure,
        auth: {
            user,
            pass
        },
        tls: {
            rejectUnauthorized: false
        }
    });
}

/**
 * Send password reset email with 6-digit OTP
 * @param {string} toEmail - Recipient email address
 * @param {string} otpCode - 6-digit verification code
 * @param {string} recipientName - Name of the user
 */
async function sendPasswordResetEmail(toEmail, otpCode, recipientName = "EventX User") {
    const transporter = createTransporter();
    const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER || '"EventX Support" <no-reply@eventx.com>';

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {
                margin: 0;
                padding: 0;
                background-color: #090d16;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                color: #f8fafc;
            }
            .email-container {
                max-width: 560px;
                margin: 30px auto;
                background: #0f172a;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                overflow: hidden;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            }
            .email-header {
                background: linear-gradient(135deg, #1e3a8a, #2563eb);
                padding: 28px 30px;
                text-align: center;
            }
            .logo-text {
                font-size: 26px;
                font-weight: 800;
                color: #ffffff;
                letter-spacing: -0.5px;
                margin: 0;
            }
            .logo-text span {
                color: #93c5fd;
            }
            .email-body {
                padding: 35px 30px;
            }
            .greeting {
                font-size: 18px;
                font-weight: 600;
                color: #f8fafc;
                margin-top: 0;
                margin-bottom: 12px;
            }
            .intro-text {
                font-size: 14px;
                line-height: 1.6;
                color: #94a3b8;
                margin-bottom: 25px;
            }
            .otp-box-wrapper {
                text-align: center;
                margin: 30px 0;
            }
            .otp-box {
                display: inline-block;
                background: rgba(37, 99, 235, 0.15);
                border: 2px dashed #3b82f6;
                border-radius: 12px;
                padding: 16px 36px;
                font-size: 32px;
                font-weight: 800;
                letter-spacing: 8px;
                color: #60a5fa;
                font-family: 'Courier New', Courier, monospace;
            }
            .expiry-badge {
                display: inline-block;
                margin-top: 10px;
                font-size: 12px;
                color: #f59e0b;
                background: rgba(245, 158, 11, 0.1);
                border: 1px solid rgba(245, 158, 11, 0.25);
                padding: 4px 12px;
                border-radius: 20px;
                font-weight: 600;
            }
            .warning-card {
                background: rgba(255, 255, 255, 0.03);
                border-left: 3px solid #60a5fa;
                border-radius: 6px;
                padding: 12px 16px;
                font-size: 12px;
                color: #94a3b8;
                line-height: 1.5;
                margin-top: 25px;
            }
            .email-footer {
                padding: 20px 30px;
                background: #090d16;
                border-top: 1px solid rgba(255, 255, 255, 0.06);
                text-align: center;
                font-size: 12px;
                color: #64748b;
            }
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="email-header">
                <h1 class="logo-text">Event<span>X</span> Portal</h1>
            </div>
            <div class="email-body">
                <p class="greeting">Hello, ${recipientName}</p>
                <p class="intro-text">
                    We received a request to reset the password for your EventX account.
                    Please use the single-use verification code below to complete your password reset:
                </p>

                <div class="otp-box-wrapper">
                    <div class="otp-box">${otpCode}</div>
                    <br>
                    <div class="expiry-badge">⏱️ Valid for 10 minutes only</div>
                </div>

                <div class="warning-card">
                    <strong>Security Notice:</strong>
                    This code is single-use and will expire in 10 minutes. If you did not initiate this request, you can safely ignore this email — your account remains secure.
                </div>
            </div>
            <div class="email-footer">
                &copy; 2026 EventX — College Event Management System.
            </div>
        </div>
    </body>
    </html>
    `;

    if (!transporter) {
        // Fallback for development if SMTP is not configured
        console.warn("[EmailService] SMTP credentials not fully configured in environment variables. Set EMAIL_HOST, EMAIL_USER, EMAIL_PASSWORD in .env.");
        return {
            delivered: false,
            message: "SMTP credentials not configured"
        };
    }

    try {
        const info = await transporter.sendMail({
            from: fromAddress,
            to: toEmail,
            subject: "EventX - Password Reset Verification Code",
            text: `Your EventX password reset code is: ${otpCode}. It is valid for 10 minutes.`,
            html: htmlContent
        });

        return {
            delivered: true,
            messageId: info.messageId
        };
    } catch (error) {
        console.error("[EmailService] Failed to send password reset email:", error.message);
        return {
            delivered: false,
            error: error.message
        };
    }
}

module.exports = {
    sendPasswordResetEmail
};
