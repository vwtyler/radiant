const { sign, verify, generateRefreshToken } = require('./jwt');
const { hash, verify: verifyPassword, validatePassword } = require('./password');
const { sendInvitationEmail, sendPasswordResetEmail, sendWelcomeEmail } = require('./email');
const crypto = require('crypto');

const ACCESS_TOKEN_EXPIRY = '7d';
const REFRESH_TOKEN_EXPIRY_DAYS = 90;
const INVITATION_EXPIRY_DAYS = 7;
const PASSWORD_RESET_EXPIRY_HOURS = 1;

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getClientInfo(req) {
  return {
    ip: req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown'
  };
}

async function createAuthRoutes(pool) {
  async function query(text, params) {
    const client = await pool.connect();
    try {
      return await client.query(text, params);
    } finally {
      client.release();
    }
  }

  return {
    // POST /v1/admin/auth/login
    async login(req, res, corsHeaders) {
      try {
        const body = await readBody(req);
        const { email, password, rememberMe } = body;

        if (!email || !password) {
          return sendJson(res, 400, { error: 'Email and password required' }, corsHeaders);
        }

        // Find user
        const userResult = await query(
          'SELECT id, email, password_hash, role, status, dj_id FROM app_admin_users WHERE email = $1',
          [email.toLowerCase().trim()]
        );

        if (userResult.rows.length === 0) {
          return sendJson(res, 401, { error: 'Invalid credentials' }, corsHeaders);
        }

        const user = userResult.rows[0];

        if (user.status !== 'active') {
          return sendJson(res, 401, { error: 'Account is not active' }, corsHeaders);
        }

        // Verify password
        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) {
          return sendJson(res, 401, { error: 'Invalid credentials' }, corsHeaders);
        }

        // Update last login
        await query('UPDATE app_admin_users SET last_login_at = NOW() WHERE id = $1', [user.id]);

        // Create session
        const accessToken = sign(
          { userId: user.id, email: user.email, role: user.role, djId: user.dj_id },
          ACCESS_TOKEN_EXPIRY
        );

        let refreshToken = null;
        let refreshExpiresAt = null;

        if (rememberMe) {
          refreshToken = generateRefreshToken();
          refreshExpiresAt = new Date();
          refreshExpiresAt.setDate(refreshExpiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
        }

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        const clientInfo = getClientInfo(req);

        await query(
          `INSERT INTO app_admin_sessions (user_id, token, refresh_token, expires_at, refresh_expires_at, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [user.id, accessToken, refreshToken, expiresAt, refreshExpiresAt, clientInfo.ip, clientInfo.userAgent]
        );

        return sendJson(res, 200, {
          accessToken,
          refreshToken,
          expiresAt: expiresAt.toISOString(),
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            djId: user.dj_id
          }
        }, corsHeaders);
      } catch (error) {
        console.error('Login error:', error);
        return sendJson(res, 500, { error: 'Login failed' }, corsHeaders);
      }
    },

    // POST /v1/admin/auth/logout
    async logout(req, res, corsHeaders) {
      try {
        const authHeader = req.headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) {
          return sendJson(res, 200, { message: 'Logged out' }, corsHeaders);
        }

        const token = authHeader.slice(7);
        await query('DELETE FROM app_admin_sessions WHERE token = $1', [token]);

        return sendJson(res, 200, { message: 'Logged out' }, corsHeaders);
      } catch (error) {
        console.error('Logout error:', error);
        return sendJson(res, 500, { error: 'Logout failed' }, corsHeaders);
      }
    },

    // POST /v1/admin/auth/refresh
    async refresh(req, res, corsHeaders) {
      try {
        const body = await readBody(req);
        const { refreshToken } = body;

        if (!refreshToken) {
          return sendJson(res, 401, { error: 'Refresh token required' }, corsHeaders);
        }

        // Find session with valid refresh token
        const sessionResult = await query(
          `SELECT s.id, s.user_id, s.refresh_expires_at, u.email, u.role, u.dj_id, u.status
           FROM app_admin_sessions s
           JOIN app_admin_users u ON s.user_id = u.id
           WHERE s.refresh_token = $1 AND s.refresh_expires_at > NOW()`,
          [refreshToken]
        );

        if (sessionResult.rows.length === 0) {
          return sendJson(res, 401, { error: 'Invalid or expired refresh token' }, corsHeaders);
        }

        const session = sessionResult.rows[0];

        if (session.status !== 'active') {
          return sendJson(res, 401, { error: 'Account is not active' }, corsHeaders);
        }

        // Generate new access token
        const accessToken = sign(
          { userId: session.user_id, email: session.email, role: session.role, djId: session.dj_id },
          ACCESS_TOKEN_EXPIRY
        );

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        // Update session
        await query(
          'UPDATE app_admin_sessions SET token = $1, expires_at = $2 WHERE id = $3',
          [accessToken, expiresAt, session.id]
        );

        return sendJson(res, 200, {
          accessToken,
          expiresAt: expiresAt.toISOString()
        }, corsHeaders);
      } catch (error) {
        console.error('Refresh error:', error);
        return sendJson(res, 500, { error: 'Token refresh failed' }, corsHeaders);
      }
    },

    // POST /v1/admin/auth/invite
    async invite(req, res, corsHeaders, currentUser) {
      try {
        // Only admins can invite
        if (currentUser.role !== 'super_admin' && currentUser.role !== 'admin') {
          return sendJson(res, 403, { error: 'Only admins can invite users' }, corsHeaders);
        }

        const body = await readBody(req);
        const { email, role, djId } = body;

        if (!email || !role) {
          return sendJson(res, 400, { error: 'Email and role required' }, corsHeaders);
        }

        if (!['admin', 'dj'].includes(role)) {
          return sendJson(res, 400, { error: 'Invalid role. Must be admin or dj' }, corsHeaders);
        }

        // Check if user already exists
        const existingResult = await query(
          'SELECT id FROM app_admin_users WHERE email = $1',
          [email.toLowerCase().trim()]
        );

        if (existingResult.rows.length > 0) {
          return sendJson(res, 409, { error: 'User already exists' }, corsHeaders);
        }

        // Check for existing pending invitation
        const existingInviteResult = await query(
          'SELECT id FROM app_admin_invitations WHERE email = $1 AND accepted_at IS NULL AND expires_at > NOW()',
          [email.toLowerCase().trim()]
        );

        if (existingInviteResult.rows.length > 0) {
          return sendJson(res, 409, { error: 'Pending invitation already exists' }, corsHeaders);
        }

        // Create invitation
        const token = generateToken();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

        await query(
          `INSERT INTO app_admin_invitations (email, token, role, dj_id, invited_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [email.toLowerCase().trim(), token, role, djId || null, currentUser.userId, expiresAt]
        );

        // Send email
        const emailResult = await sendInvitationEmail({
          to: email,
          token,
          role,
          invitedBy: currentUser.email
        });

        if (!emailResult.success && !emailResult.mock) {
          console.error('Failed to send invitation email:', emailResult.error);
          // Don't fail the request, just log it
        }

        return sendJson(res, 201, {
          message: 'Invitation sent',
          email: email,
          role: role,
          emailSent: emailResult.success
        }, corsHeaders);
      } catch (error) {
        console.error('Invite error:', error);
        return sendJson(res, 500, { error: 'Invitation failed' }, corsHeaders);
      }
    },

    // POST /v1/admin/auth/accept
    async accept(req, res, corsHeaders) {
      try {
        const body = await readBody(req);
        const { token, password } = body;

        if (!token || !password) {
          return sendJson(res, 400, { error: 'Token and password required' }, corsHeaders);
        }

        // Validate password
        const passwordCheck = validatePassword(password);
        if (!passwordCheck.valid) {
          return sendJson(res, 400, { error: 'Invalid password', details: passwordCheck.errors }, corsHeaders);
        }

        // Find valid invitation
        const inviteResult = await query(
          `SELECT id, email, role, dj_id FROM app_admin_invitations 
           WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW()`,
          [token]
        );

        if (inviteResult.rows.length === 0) {
          return sendJson(res, 400, { error: 'Invalid or expired invitation' }, corsHeaders);
        }

        const invitation = inviteResult.rows[0];

        // Check if user already exists
        const existingResult = await query(
          'SELECT id FROM app_admin_users WHERE email = $1',
          [invitation.email]
        );

        if (existingResult.rows.length > 0) {
          return sendJson(res, 409, { error: 'User already exists' }, corsHeaders);
        }

        // Hash password
        const passwordHash = await hash(password);

        // Create user
        const userResult = await query(
          `INSERT INTO app_admin_users (email, password_hash, role, dj_id, status, email_verified)
           VALUES ($1, $2, $3, $4, 'active', true)
           RETURNING id`,
          [invitation.email, passwordHash, invitation.role, invitation.dj_id]
        );

        const userId = userResult.rows[0].id;

        // Mark invitation as accepted
        await query('UPDATE app_admin_invitations SET accepted_at = NOW() WHERE id = $1', [invitation.id]);

        // Send welcome email
        await sendWelcomeEmail({
          to: invitation.email,
          role: invitation.role
        });

        return sendJson(res, 201, {
          message: 'Account created successfully',
          userId: userId
        }, corsHeaders);
      } catch (error) {
        console.error('Accept invitation error:', error);
        return sendJson(res, 500, { error: 'Account creation failed' }, corsHeaders);
      }
    },

    // POST /v1/admin/auth/forgot
    async forgot(req, res, corsHeaders) {
      try {
        const body = await readBody(req);
        const { email } = body;

        if (!email) {
          return sendJson(res, 400, { error: 'Email required' }, corsHeaders);
        }

        // Find user
        const userResult = await query(
          'SELECT id, email FROM app_admin_users WHERE email = $1 AND status = $2',
          [email.toLowerCase().trim(), 'active']
        );

        // Always return success to prevent email enumeration
        if (userResult.rows.length === 0) {
          return sendJson(res, 200, { message: 'If an account exists, a reset email has been sent' }, corsHeaders);
        }

        const user = userResult.rows[0];

        // Invalidate existing tokens
        await query('UPDATE app_password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [user.id]);

        // Create reset token
        const token = generateToken();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + PASSWORD_RESET_EXPIRY_HOURS);

        await query(
          'INSERT INTO app_password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)',
          [user.id, token, expiresAt]
        );

        // Send email
        await sendPasswordResetEmail({
          to: user.email,
          token
        });

        return sendJson(res, 200, { message: 'If an account exists, a reset email has been sent' }, corsHeaders);
      } catch (error) {
        console.error('Forgot password error:', error);
        return sendJson(res, 500, { error: 'Password reset request failed' }, corsHeaders);
      }
    },

    // POST /v1/admin/auth/reset
    async reset(req, res, corsHeaders) {
      try {
        const body = await readBody(req);
        const { token, password } = body;

        if (!token || !password) {
          return sendJson(res, 400, { error: 'Token and password required' }, corsHeaders);
        }

        // Validate password
        const passwordCheck = validatePassword(password);
        if (!passwordCheck.valid) {
          return sendJson(res, 400, { error: 'Invalid password', details: passwordCheck.errors }, corsHeaders);
        }

        // Find valid reset token
        const resetResult = await query(
          `SELECT id, user_id FROM app_password_resets 
           WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()`,
          [token]
        );

        if (resetResult.rows.length === 0) {
          return sendJson(res, 400, { error: 'Invalid or expired reset token' }, corsHeaders);
        }

        const reset = resetResult.rows[0];

        // Hash new password
        const passwordHash = await hash(password);

        // Update user password
        await query('UPDATE app_admin_users SET password_hash = $1 WHERE id = $2', [passwordHash, reset.user_id]);

        // Mark token as used
        await query('UPDATE app_password_resets SET used_at = NOW() WHERE id = $1', [reset.id]);

        // Delete all sessions for this user (force re-login)
        await query('DELETE FROM app_admin_sessions WHERE user_id = $1', [reset.user_id]);

        return sendJson(res, 200, { message: 'Password reset successfully' }, corsHeaders);
      } catch (error) {
        console.error('Reset password error:', error);
        return sendJson(res, 500, { error: 'Password reset failed' }, corsHeaders);
      }
    },

    // GET /v1/admin/auth/me
    async me(req, res, corsHeaders, currentUser) {
      try {
        const result = await query(
          `SELECT id, email, role, status, dj_id, created_at, last_login_at 
           FROM app_admin_users WHERE id = $1`,
          [currentUser.userId]
        );

        if (result.rows.length === 0) {
          return sendJson(res, 404, { error: 'User not found' }, corsHeaders);
        }

        const user = result.rows[0];

        return sendJson(res, 200, {
          id: user.id,
          email: user.email,
          role: user.role,
          status: user.status,
          djId: user.dj_id,
          createdAt: user.created_at,
          lastLoginAt: user.last_login_at
        }, corsHeaders);
      } catch (error) {
        console.error('Get user error:', error);
        return sendJson(res, 500, { error: 'Failed to get user info' }, corsHeaders);
      }
    },

    // POST /v1/admin/auth/change-password
    async changePassword(req, res, corsHeaders, currentUser) {
      try {
        const body = await readBody(req);
        const { currentPassword, newPassword } = body;

        if (!currentPassword || !newPassword) {
          return sendJson(res, 400, { error: 'Current password and new password required' }, corsHeaders);
        }

        // Validate new password
        const passwordCheck = validatePassword(newPassword);
        if (!passwordCheck.valid) {
          return sendJson(res, 400, { error: 'Invalid password', details: passwordCheck.errors }, corsHeaders);
        }

        // Get user with password hash
        const userResult = await query(
          'SELECT password_hash FROM app_admin_users WHERE id = $1 AND status = $2',
          [currentUser.userId, 'active']
        );

        if (userResult.rows.length === 0) {
          return sendJson(res, 404, { error: 'User not found' }, corsHeaders);
        }

        // Verify current password
        const valid = await verifyPassword(currentPassword, userResult.rows[0].password_hash);
        if (!valid) {
          return sendJson(res, 401, { error: 'Current password is incorrect' }, corsHeaders);
        }

        // Hash new password
        const passwordHash = await hash(newPassword);

        // Update password
        await query(
          'UPDATE app_admin_users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
          [passwordHash, currentUser.userId]
        );

        return sendJson(res, 200, { message: 'Password changed successfully' }, corsHeaders);
      } catch (error) {
        console.error('Change password error:', error);
        return sendJson(res, 500, { error: 'Failed to change password' }, corsHeaders);
      }
    },

    // POST /v1/admin/auth/link-dj
    async linkDj(req, res, corsHeaders, currentUser) {
      try {
        const body = await readBody(req);
        const { djId } = body;

        // Only DJs can link to a DJ profile
        if (currentUser.role !== 'super_admin' && currentUser.role !== 'admin' && currentUser.role !== 'dj') {
          return sendJson(res, 403, { error: 'Only DJs can link to DJ profiles' }, corsHeaders);
        }

        // Validate DJ exists if djId is provided
        if (djId) {
          const djResult = await query('SELECT id FROM djs WHERE id = $1', [djId]);
          if (djResult.rows.length === 0) {
            return sendJson(res, 404, { error: 'DJ not found' }, corsHeaders);
          }
        }

        // Update user's DJ association
        await query(
          'UPDATE app_admin_users SET dj_id = $1, updated_at = NOW() WHERE id = $2',
          [djId || null, currentUser.userId]
        );

        return sendJson(res, 200, { 
          message: djId ? 'DJ linked successfully' : 'DJ unlinked successfully',
          djId: djId || null
        }, corsHeaders);
      } catch (error) {
        console.error('Link DJ error:', error);
        return sendJson(res, 500, { error: 'Failed to link DJ' }, corsHeaders);
      }
    },

    // GET /v1/admin/users - List all users (admin only)
    async listUsers(req, res, corsHeaders, currentUser) {
      try {
        // Only admins can list users
        if (currentUser.role !== 'super_admin' && currentUser.role !== 'admin') {
          return sendJson(res, 403, { error: 'Only admins can list users' }, corsHeaders);
        }

        const result = await query(
          `SELECT id, email, role, status, dj_id, created_at, last_login_at 
           FROM app_admin_users 
           ORDER BY created_at DESC`
        );

        const users = result.rows.map(user => ({
          id: user.id,
          email: user.email,
          role: user.role,
          status: user.status,
          djId: user.dj_id,
          createdAt: user.created_at,
          lastLoginAt: user.last_login_at
        }));

        return sendJson(res, 200, { items: users }, corsHeaders);
      } catch (error) {
        console.error('List users error:', error);
        return sendJson(res, 500, { error: 'Failed to list users' }, corsHeaders);
      }
    },

    // PATCH /v1/admin/users/:id - Update user (admin only)
    async updateUser(req, res, corsHeaders, currentUser) {
      try {
        // Only admins can update users
        if (currentUser.role !== 'super_admin' && currentUser.role !== 'admin') {
          return sendJson(res, 403, { error: 'Only admins can update users' }, corsHeaders);
        }

        // Extract user ID from path
        const pathParts = req.url.split('/');
        const userId = pathParts[pathParts.length - 1];

        const body = await readBody(req);
        const { role, status } = body;

        // Build update query dynamically
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (role) {
          if (!['super_admin', 'admin', 'dj'].includes(role)) {
            return sendJson(res, 400, { error: 'Invalid role' }, corsHeaders);
          }
          // Only super_admins can create other super_admins
          if (role === 'super_admin' && currentUser.role !== 'super_admin') {
            return sendJson(res, 403, { error: 'Only super admins can assign super admin role' }, corsHeaders);
          }
          updates.push(`role = $${paramIndex++}`);
          values.push(role);
        }

        if (status) {
          if (!['active', 'inactive'].includes(status)) {
            return sendJson(res, 400, { error: 'Invalid status' }, corsHeaders);
          }
          updates.push(`status = $${paramIndex++}`);
          values.push(status);
        }

        if (updates.length === 0) {
          return sendJson(res, 400, { error: 'No updates provided' }, corsHeaders);
        }

        values.push(userId);

        const result = await query(
          `UPDATE app_admin_users SET ${updates.join(', ')}, updated_at = NOW() 
           WHERE id = $${paramIndex} RETURNING id`,
          values
        );

        if (result.rows.length === 0) {
          return sendJson(res, 404, { error: 'User not found' }, corsHeaders);
        }

        return sendJson(res, 200, { message: 'User updated successfully' }, corsHeaders);
      } catch (error) {
        console.error('Update user error:', error);
        return sendJson(res, 500, { error: 'Failed to update user' }, corsHeaders);
      }
    },

    // DELETE /v1/admin/users/:id - Delete user (admin only)
    async deleteUser(req, res, corsHeaders, currentUser) {
      try {
        // Only admins can delete users
        if (currentUser.role !== 'super_admin' && currentUser.role !== 'admin') {
          return sendJson(res, 403, { error: 'Only admins can delete users' }, corsHeaders);
        }

        // Extract user ID from path
        const pathParts = req.url.split('/');
        const userId = pathParts[pathParts.length - 1];

        // Prevent deleting yourself
        if (parseInt(userId) === currentUser.userId) {
          return sendJson(res, 400, { error: 'Cannot delete your own account' }, corsHeaders);
        }

        // Check if target user is super_admin - only super_admins can delete super_admins
        const targetUser = await query(
          'SELECT role FROM app_admin_users WHERE id = $1',
          [userId]
        );

        if (targetUser.rows.length === 0) {
          return sendJson(res, 404, { error: 'User not found' }, corsHeaders);
        }

        if (targetUser.rows[0].role === 'super_admin' && currentUser.role !== 'super_admin') {
          return sendJson(res, 403, { error: 'Only super admins can delete super admin accounts' }, corsHeaders);
        }

        // Delete user (cascades to sessions via foreign key)
        await query('DELETE FROM app_admin_users WHERE id = $1', [userId]);

        return sendJson(res, 200, { message: 'User deleted successfully' }, corsHeaders);
      } catch (error) {
        console.error('Delete user error:', error);
        return sendJson(res, 500, { error: 'Failed to delete user' }, corsHeaders);
      }
    },

    // POST /v1/admin/users/:id/reset-password - Reset user password (admin only)
    async adminResetPassword(req, res, corsHeaders, currentUser) {
      try {
        // Only admins can reset passwords
        if (currentUser.role !== 'super_admin' && currentUser.role !== 'admin') {
          return sendJson(res, 403, { error: 'Only admins can reset passwords' }, corsHeaders);
        }

        // Extract user ID from path
        const pathParts = req.url.split('/');
        const userId = pathParts[pathParts.length - 2]; // /users/:id/reset-password

        const body = await readBody(req);
        const { password } = body;

        if (!password) {
          return sendJson(res, 400, { error: 'Password required' }, corsHeaders);
        }

        // Validate password
        const passwordCheck = validatePassword(password);
        if (!passwordCheck.valid) {
          return sendJson(res, 400, { error: 'Invalid password', details: passwordCheck.errors }, corsHeaders);
        }

        // Hash new password
        const passwordHash = await hash(password);

        // Update user password and delete all sessions
        const result = await query(
          `UPDATE app_admin_users SET password_hash = $1, updated_at = NOW() 
           WHERE id = $2 RETURNING id`,
          [passwordHash, userId]
        );

        if (result.rows.length === 0) {
          return sendJson(res, 404, { error: 'User not found' }, corsHeaders);
        }

        // Delete all sessions for this user (force re-login)
        await query('DELETE FROM app_admin_sessions WHERE user_id = $1', [userId]);

        return sendJson(res, 200, { message: 'Password reset successfully' }, corsHeaders);
      } catch (error) {
        console.error('Admin reset password error:', error);
        return sendJson(res, 500, { error: 'Failed to reset password' }, corsHeaders);
      }
    },

    // Helper to read request body
    readBody
  };
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data, corsHeaders) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders });
  res.end(JSON.stringify(data));
}

module.exports = { createAuthRoutes };
