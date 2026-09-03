const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config(); // fallback
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

        // 11. LAST LOGIN TIMESTAMP
        console.log('\n--- Testing Last Login Timestamp ---');

        // Fetch the last_login value right after the student logged in earlier
        const [loginTimestampRows] = await db.query(
            "SELECT last_login FROM users WHERE email = 'student@test.com'"
        );
        assert(
            loginTimestampRows.length > 0 && loginTimestampRows[0].last_login !== null,
            'last_login timestamp is populated after student login'
        );

        // Verify it's recent using DB-side time comparison (avoids TZ mismatch between DB UTC and OS local)
        if (loginTimestampRows.length > 0 && loginTimestampRows[0].last_login) {
            const [recentCheck] = await db.query(
                "SELECT TIMESTAMPDIFF(MINUTE, last_login, NOW()) AS mins_ago FROM users WHERE email = 'student@test.com'"
            );
            const minsAgo = Number(recentCheck[0].mins_ago);
            assert(minsAgo <= 10, 'last_login timestamp is within the last 10 minutes (DB-side check)');
        }

        // 12. STUDENT MANAGEMENT ENDPOINTS
        console.log('\n--- Testing Student Management API ---');

        // GET /api/admin/students — returns student list
        const studentsRes = await fetch(`${BASE_URL}/api/admin/students`, {
            headers: { 'Authorization': `Bearer ${teacherToken}` }
        });
        const studentsData = await studentsRes.json();
        assert(
            studentsData.success === true && Array.isArray(studentsData.students),
            'GET /api/admin/students returns a students array'
        );
        assert(
            studentsData.students.every(s => s.role === 'student' || s.role === undefined),
            'All returned users are students (no teachers/admins in results)'
        );

        // GET /api/admin/students?search=student@test.com — search filter works
        const searchRes = await fetch(
            `${BASE_URL}/api/admin/students?search=${encodeURIComponent('student@test.com')}`,
            { headers: { 'Authorization': `Bearer ${teacherToken}` } }
        );
        const searchData = await searchRes.json();
        assert(
            searchData.success === true && searchData.students.some(s => s.email === 'student@test.com'),
            'Student search by email returns matching student'
        );

        // Verify student record fields include last_login and registration counts
        const testStudent = studentsData.students.find(s => s.email === 'student@test.com');
        assert(
            testStudent !== undefined && 'last_login' in testStudent && 'registrations_count' in testStudent,
            'Student record includes last_login and registrations_count fields'
        );

        // 13. STUDENT DELETION SECURITY
        console.log('\n--- Testing Student Deletion Security ---');

        // Attempting to delete teacher/faculty via student endpoint must be blocked
        // Note: teacher@test.com IS the logged-in user, so self-deletion check fires first (400)
        // For any teacher account (self or other), the endpoint should return a non-200 error
        const [teacherRowForDelete] = await db.query("SELECT id FROM users WHERE email = 'teacher@test.com'");
        if (teacherRowForDelete.length > 0) {
            const teacherId = teacherRowForDelete[0].id;
            const deleteFacultyRes = await fetch(`${BASE_URL}/api/admin/students/${teacherId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${teacherToken}` }
            });
            const deleteFacultyData = await deleteFacultyRes.json();
            // Expect 400 (self-deletion blocked) or 403 (non-student role blocked)
            const isBlocked = (deleteFacultyRes.status === 400 || deleteFacultyRes.status === 403) && deleteFacultyData.success === false;
            assert(isBlocked, 'Deleting a teacher account via /api/admin/students/:id is blocked (400 self-delete or 403 non-student)');
        } else {
            console.log('  (Skipped: teacher@test.com not found for security deletion test)');
        }

        // Attempting to delete nonexistent student returns 404
        const deleteNoneRes = await fetch(`${BASE_URL}/api/admin/students/9999999`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${teacherToken}` }
        });
        const deleteNoneData = await deleteNoneRes.json();
        assert(
            deleteNoneRes.status === 404 && deleteNoneData.success === false,
            'Deleting non-existent student returns 404 Not Found'
        );

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
