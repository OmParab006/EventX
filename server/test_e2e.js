const crypto = require('crypto');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const db = require('./db');

const BASE_URL = 'http://localhost:5000';

async function runTests() {
    console.log('==============================================');
    console.log('  STARTING EVENTX AUTOMATED TESTS');
    console.log('==============================================\n');

    let passed = 0;
    let failed = 0;

    function assert(condition, testName) {
        if (condition) {
            console.log(`  ✓ PASS: ${testName}`);
            passed++;
        } else {
            console.error(`  ✗ FAIL: ${testName}`);
            failed++;
        }
    }

    try {
        // 1. Health check & Events loading
        const eventsRes = await fetch(`${BASE_URL}/api/events`);
        const eventsData = await eventsRes.json();
        assert(eventsData.success === true && Array.isArray(eventsData.events), 'Public events endpoint returns events list');

        // 2. Public stats
        const statsRes = await fetch(`${BASE_URL}/api/auth/public-stats`);
        const statsData = await statsRes.json();
        assert(statsData.success === true && statsData.stats.totalEvents >= 0, 'Public stats endpoint returns live stats');

        // 3. Student Login
        const studentLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'student@test.com', password: 'student123' })
        });
        const studentLoginData = await studentLoginRes.json();
        assert(studentLoginData.success === true && studentLoginData.user.role === 'student' && !!studentLoginData.token, 'Student login succeeds');

        // 4. Teacher Login (Ensure teacher@test.com exists and has password)
        // Let's set teacher password to teacher123 if needed
        const [teacherUser] = await db.query("SELECT * FROM users WHERE email = 'teacher@test.com'");
        if (teacherUser.length > 0) {
            const teacherMatches = await bcrypt.compare('teacher123', teacherUser[0].password);
            if (!teacherMatches) {
                const newHash = await bcrypt.hash('teacher123', 10);
                await db.query("UPDATE users SET password = ? WHERE email = 'teacher@test.com'", [newHash]);
            }
        }

        const teacherLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'teacher@test.com', password: 'teacher123' })
        });
        const teacherLoginData = await teacherLoginRes.json();
        assert(teacherLoginData.success === true && teacherLoginData.user.role === 'teacher' && !!teacherLoginData.token, 'Teacher login succeeds');

        const teacherToken = teacherLoginData.token;

        // 5. Teacher Stats & Dashboard APIs
        const adminStatsRes = await fetch(`${BASE_URL}/api/admin/stats`, {
            headers: { 'Authorization': `Bearer ${teacherToken}` }
        });
        const adminStatsData = await adminStatsRes.json();
        assert(adminStatsData.success === true && typeof adminStatsData.stats.revenue === 'number', 'Teacher /api/admin/stats returns statistics');

        const adminRegsRes = await fetch(`${BASE_URL}/api/admin/registrations`, {
            headers: { 'Authorization': `Bearer ${teacherToken}` }
        });
        const adminRegsData = await adminRegsRes.json();
        assert(adminRegsData.success === true && Array.isArray(adminRegsData.registrations), 'Teacher /api/admin/registrations returns registrations');

        const adminPaymentsRes = await fetch(`${BASE_URL}/api/admin/payments`, {
            headers: { 'Authorization': `Bearer ${teacherToken}` }
        });
        const adminPaymentsData = await adminPaymentsRes.json();
        assert(adminPaymentsData.success === true && Array.isArray(adminPaymentsData.payments), 'Teacher /api/admin/payments returns payments');

        // 6. FORGOT PASSWORD FLOW
        console.log('\n--- Testing Forgot Password & Password Reset ---');
        
        // Step 1: Request OTP for non-existing email -> Should return generic success
        const nonExistRes = await fetch(`${BASE_URL}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'nonexistentuser999@test.com' })
        });
        const nonExistData = await nonExistRes.json();
        assert(nonExistData.success === true && nonExistData.message.includes('verification code has been sent'), 'Non-existent email returns generic security message without error');

        // Step 2: Request OTP for student@test.com
        // Clear rate limit for clean test run
        const resetReqRes = await fetch(`${BASE_URL}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'student@test.com' })
        });
        const resetReqData = await resetReqRes.json();
        assert(resetReqData.success === true, 'Forgot password request for valid student succeeds');

        // Check DB for created OTP record
        const [tokens] = await db.query(
            "SELECT * FROM password_reset_tokens WHERE email = 'student@test.com' AND is_used = 0 ORDER BY id DESC LIMIT 1"
        );
        assert(tokens.length === 1 && tokens[0].otp_hash.length === 64, 'OTP record saved with SHA-256 hash in database');

        const latestTokenRecord = tokens[0];

        // Step 3: Verify OTP with incorrect code -> Should fail
        const wrongOtpRes = await fetch(`${BASE_URL}/api/auth/verify-reset-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'student@test.com', otp: '000000' })
        });
        const wrongOtpData = await wrongOtpRes.json();
        assert(wrongOtpRes.status === 400 && wrongOtpData.success === false, 'Incorrect OTP code is rejected');

        // To verify correct OTP: let's generate a known OTP for testing
        const testOtp = '654321';
        const testOtpHash = crypto.createHash('sha256').update(testOtp).digest('hex');
        await db.query(
            "UPDATE password_reset_tokens SET otp_hash = ?, attempts = 0 WHERE id = ?",
            [testOtpHash, latestTokenRecord.id]
        );

        // Step 4: Verify OTP with correct code -> Should return resetToken
        const verifyRes = await fetch(`${BASE_URL}/api/auth/verify-reset-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'student@test.com', otp: testOtp })
        });
        const verifyData = await verifyRes.json();
        assert(verifyData.success === true && typeof verifyData.resetToken === 'string' && verifyData.resetToken.length > 20, 'Correct OTP is verified and returns secure resetToken');

        const clientResetToken = verifyData.resetToken;

        // Step 5: Reset password with mismatched passwords -> Should fail
        const mismatchRes = await fetch(`${BASE_URL}/api/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'student@test.com',
                resetToken: clientResetToken,
                newPassword: 'newPassword123',
                confirmPassword: 'differentPassword123'
            })
        });
        const mismatchData = await mismatchRes.json();
        assert(mismatchRes.status === 400 && mismatchData.success === false, 'Mismatched passwords rejected');

        // Step 6: Reset password with short password -> Should fail
        const shortRes = await fetch(`${BASE_URL}/api/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'student@test.com',
                resetToken: clientResetToken,
                newPassword: '123',
                confirmPassword: '123'
            })
        });
        const shortData = await shortRes.json();
        assert(shortRes.status === 400 && shortData.success === false, 'Short password (<6 chars) rejected');

        // Step 7: Reset password with valid new password
        const newTestPass = 'myBrandNewPass2026!';
        const validResetRes = await fetch(`${BASE_URL}/api/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'student@test.com',
                resetToken: clientResetToken,
                newPassword: newTestPass,
                confirmPassword: newTestPass
            })
        });
        const validResetData = await validResetRes.json();
        assert(validResetData.success === true && validResetData.message.includes('Password reset successfully'), 'Password reset succeeds');

        // Step 8: Token is marked as used and cannot be reused
        const [usedTokenCheck] = await db.query("SELECT is_used FROM password_reset_tokens WHERE id = ?", [latestTokenRecord.id]);
        assert(usedTokenCheck[0].is_used === 1, 'Password reset token is marked as is_used = 1 in database');

        const reuseRes = await fetch(`${BASE_URL}/api/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'student@test.com',
                resetToken: clientResetToken,
                newPassword: 'anotherPass123',
                confirmPassword: 'anotherPass123'
            })
        });
        const reuseData = await reuseRes.json();
        assert(reuseRes.status === 400 && reuseData.success === false, 'Reusing used resetToken is rejected');

        // Step 9: Verify old password no longer works
        const oldLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'student@test.com', password: 'student123' })
        });
        assert(oldLoginRes.status === 401, 'Old password no longer works after reset');

        // Step 10: Verify new password works
        const newLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'student@test.com', password: newTestPass })
        });
        const newLoginData = await newLoginRes.json();
        assert(newLoginData.success === true && !!newLoginData.token, 'Login with new password succeeds');

        // Reset student password back to student123 for demo consistency
        const resetBackHash = await bcrypt.hash('student123', 10);
        await db.query("UPDATE users SET password = ? WHERE email = 'student@test.com'", [resetBackHash]);
        console.log('  (Reset demo student password back to student123 for evaluation)');

    } catch (err) {
        console.error('Test Execution Error:', err);
        failed++;
    } finally {
        console.log('\n==============================================');
        console.log(`  RESULTS: ${passed} PASSED | ${failed} FAILED`);
        console.log('==============================================\n');
        process.exit(failed > 0 ? 1 : 0);
    }
}

runTests();
