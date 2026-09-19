/**
 * Email Service (Stub)
 * 
 * Note: OTP / Email verification has been completely decommissioned
 * from the EventX Forgot Password system.
 * 
 * This stub is kept to maintain backwards compatibility without triggering
 * SMTP network connections or requiring Gmail App Passwords.
 */

async function sendPasswordResetEmail(toEmail, otpCode, recipientName = "EventX User") {
    // No-op: Email OTP verification is removed
    return {
        delivered: false,
        message: "Email OTP system has been decommissioned."
    };
}

module.exports = {
    sendPasswordResetEmail
};
