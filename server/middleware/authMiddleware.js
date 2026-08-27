const jwt = require("jsonwebtoken");

// ==========================================
// VERIFY TOKEN
// ==========================================
function verifyToken(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: "Access denied. No token provided."
            });
        }

        const parts = authHeader.split(" ");
        if (parts.length !== 2 || parts[0] !== "Bearer") {
            return res.status(401).json({
                success: false,
                message: "Invalid authorization format."
            });
        }

        const token = parts[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "event_management_secret_2026");
        req.user = decoded;
        next();
    } catch (error) {
        console.error("Authentication error:", error.message);
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token."
        });
    }
}

// ==========================================
// REQUIRE ROLE (Supports string, array, admin bypass for teacher)
// ==========================================
function requireRole(allowedRoles) {
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

    return function(req, res, next) {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required."
            });
        }

        const userRole = req.user.role;
        // If 'admin', they have all teacher & organizer privileges
        if (userRole === "admin" || roles.includes(userRole) || (roles.includes("teacher") && userRole === "admin")) {
            return next();
        }

        return res.status(403).json({
            success: false,
            message: `Access denied. ${roles.join(" or ")} access required.`
        });
    };
}

module.exports = {
    verifyToken,
    requireRole
};