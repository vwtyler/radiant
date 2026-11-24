import React, { useState, useEffect } from "react";
import { useAuth, useApi } from "../auth/AuthContext";
import { InviteModal } from "../auth/InviteModal";

export function UsersTab() {
  const [users, setUsers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [resendingId, setResendingId] = useState(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [resetPasswordUser, setResetPasswordUser] = useState(null);
  const { hasRole } = useAuth();
  const { apiFetch } = useApi();

  const canManageUsers = hasRole("admin");

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      const [usersResponse, invitesResponse] = await Promise.all([
        apiFetch("/v1/admin/users"),
        apiFetch("/v1/admin/auth/invitations")
      ]);
      if (!usersResponse.ok) throw new Error("Failed to load users");
      if (!invitesResponse.ok) throw new Error("Failed to load invitations");
      const [usersData, invitesData] = await Promise.all([
        usersResponse.json(), invitesResponse.json()
      ]);
      setUsers(usersData.items || []);
      setInvitations(invitesData.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResendInvitation(invitation) {
    if (!window.confirm(`Send a new invitation to ${invitation.email}? The previous link will stop working.`)) return;
    setResendingId(invitation.id);
    setNotice("");
    setError(null);
    try {
      const response = await apiFetch(`/v1/admin/auth/invitations/${invitation.id}/resend`, {
        method: "POST"
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || "Failed to resend invitation");
      setNotice(`Invitation resent to ${invitation.email}.`);
      await loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setResendingId(null);
    }
  }

  async function handleDeleteInvitation(invite) {
    if (!window.confirm(`Delete the invitation for ${invite.email}? All outstanding invitation links for this address will stop working.`)) return;
    setResendingId(invite.id);
    setError(null);
    setNotice("");
    try {
      const response = await apiFetch(`/v1/admin/auth/invitations/${invite.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete invitation");
      setNotice(`Invitation deleted for ${invite.email}.`);
      await loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setResendingId(null);
    }
  }

  async function handleDeleteUser(userId) {
    if (!confirm("Are you sure you want to delete this user?")) return;
    
    try {
      const response = await apiFetch(`/v1/admin/users/${userId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete user");
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdateUser(userId, updates) {
    try {
      const response = await apiFetch(`/v1/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error("Failed to update user");
      await loadUsers();
      setEditingUser(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleResetPassword(userId, newPassword) {
    try {
      const response = await apiFetch(`/v1/admin/users/${userId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: newPassword }),
      });
      if (!response.ok) throw new Error("Failed to reset password");
      setResetPasswordUser(null);
      alert("Password reset successfully");
    } catch (err) {
      setError(err.message);
    }
  }

  function getRoleBadgeClass(role) {
    switch (role) {
      case "super_admin": return "role-super-admin";
      case "admin": return "role-admin";
      case "dj": return "role-dj";
      default: return "";
    }
  }

  function formatRole(role) {
    return role.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  }

  if (!canManageUsers) {
    return (
      <section className="users-shell">
        <h2>User Management</h2>
        <p className="status-bad">You don't have permission to manage users.</p>
      </section>
    );
  }

  return (
    <section className="users-shell">
      <div className="users-header">
        <h2>User Management</h2>
        <button 
          className="primary"
          onClick={() => setInviteModalOpen(true)}
        >
          Invite User
        </button>
      </div>

      {loading && <p>Loading users...</p>}
      {error && <p className="status-bad" role="alert">{error}</p>}
      {notice && <p className="status-good" role="status">{notice}</p>}

      {!loading && (
        <div className="users-table-container">
          <table className="users-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Last Activity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={`user-${user.id}`}>
                  <td><span className="user-email-status">{user.email}
                    {user.status !== "active" && <span className={`status-badge status-${user.status}`}>{user.status}</span>}
                  </span></td>
                  <td><span className={`role-badge ${getRoleBadgeClass(user.role)}`}>{formatRole(user.role)}</span></td>
                  <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</td>
                  <td><div className="user-actions">
                    <button className="ghost small" onClick={() => setEditingUser(user)}>Edit</button>
                    <button className="ghost small" onClick={() => setResetPasswordUser(user)}>Reset PW</button>
                    <button className="danger small" onClick={() => handleDeleteUser(user.id)}>Delete</button>
                  </div></td>
                </tr>
              ))}
              {invitations.map(invite => {
                const expired = new Date(invite.expiresAt).getTime() <= Date.now();
                return (
                  <tr key={`invite-${invite.id}`}>
                    <td><span className="user-email-status">{invite.email}
                      <span className={`status-badge status-${expired ? "inactive" : "pending"}`}>{expired ? "Expired" : "Pending"}</span>
                    </span></td>
                    <td><span className={`role-badge ${getRoleBadgeClass(invite.role)}`}>{formatRole(invite.role)}</span></td>
                    <td>Invited {new Date(invite.createdAt).toLocaleDateString()}
                      <div className="invite-expiry">{expired ? "Expired" : "Expires"} {new Date(invite.expiresAt).toLocaleDateString()}</div>
                    </td>
                    <td><div className="user-actions">
                      <button type="button" className="ghost small" disabled={resendingId !== null} onClick={() => handleResendInvitation(invite)}>Resend Invite</button>
                      <button type="button" className="danger small" disabled={resendingId !== null} onClick={() => handleDeleteInvitation(invite)}>Delete</button>
                    </div></td>
                  </tr>
                );
              })}
              {!users.length && !invitations.length && <tr><td colSpan={4}>No users or invitations.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <InviteModal 
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        onInvite={() => {
          setInviteModalOpen(false);
          loadUsers();
        }}
      />

      {editingUser && (
        <EditUserDialog
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSave={handleUpdateUser}
        />
      )}

      {resetPasswordUser && (
        <ResetPasswordDialog
          user={resetPasswordUser}
          onClose={() => setResetPasswordUser(null)}
          onReset={handleResetPassword}
        />
      )}
    </section>
  );
}

function EditUserDialog({ user, onClose, onSave }) {
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setIsLoading(true);
    await onSave(user.id, { role, status });
    setIsLoading(false);
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h2>Edit User</h2>
        <p>{user.email}</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="edit-role">Role</label>
            <select
              id="edit-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="super_admin">Super Admin</option>
              <option value="admin">Admin</option>
              <option value="dj">DJ</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="edit-status">Status</label>
            <select
              id="edit-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="modal-actions">
            <button type="button" className="ghost" onClick={onClose} disabled={isLoading}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={isLoading}>
              {isLoading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ResetPasswordDialog({ user, onClose, onReset }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordErrors, setPasswordErrors] = useState([]);

  function validatePassword(pass) {
    const errors = [];
    if (pass.length < 8) errors.push("At least 8 characters");
    if (!/[A-Z]/.test(pass)) errors.push("One uppercase letter");
    if (!/[a-z]/.test(pass)) errors.push("One lowercase letter");
    if (!/[0-9]/.test(pass)) errors.push("One number");
    return errors;
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      alert("Passwords do not match");
      return;
    }
    const errors = validatePassword(newPassword);
    if (errors.length > 0) {
      alert(`Password must have: ${errors.join(", ")}`);
      return;
    }
    onReset(user.id, newPassword);
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h2>Reset Password</h2>
        <p>{user.email}</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="reset-new-password">New Password</label>
            <input
              id="reset-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setPasswordErrors(validatePassword(e.target.value));
              }}
              required
            />
            {passwordErrors.length > 0 && (
              <ul className="password-requirements">
                {passwordErrors.map((err, i) => (
                  <li key={i} className="requirement-missing">{err}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="reset-confirm-password">Confirm Password</label>
            <input
              id="reset-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button 
              type="submit" 
              className="primary"
              disabled={passwordErrors.length > 0}
            >
              Reset Password
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
