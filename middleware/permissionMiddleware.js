/**
 * Middleware to restrict route access by role
 * e.g. requireRole('admin')
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Role '${req.user.role}' is not authorized to access this resource`,
      });
    }

    next();
  };
};

/**
 * Middleware to restrict route access by permissions
 * e.g. requirePermission('user') or requirePermission('view_user', 'edit_user')
 * Matches if user has ALL or AT LEAST ONE based on options. Default requires at least one of specified permissions.
 */
const requirePermission = (...requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Admins have super-user privileges across all modules
    if (req.user.role === 'admin') {
      return next();
    }

    const userPermissions = Array.isArray(req.user.permissions)
      ? req.user.permissions
      : [];

    // Check if user has required permissions
    const hasPermission = requiredPermissions.some((perm) =>
      userPermissions.includes(perm)
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Missing required permission [${requiredPermissions.join(', ')}]`,
      });
    }

    next();
  };
};

module.exports = {
  requireRole,
  requirePermission,
};

