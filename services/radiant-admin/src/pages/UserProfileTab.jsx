import React, { useState, useEffect } from "react";
import { useAuth, useApi } from "../auth/AuthContext";
import { ChangePasswordDialog } from "../auth/ChangePasswordDialog";

export function UserProfileTab() {
  const { user, hasRole } = useAuth();
  const { apiFetch } = useApi();
  const [djs, setDjs] = useState([]);
  const [linkedDjId, setLinkedDjId] = useState(user?.djId || "");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  useEffect(() => {
    if (hasRole("dj")) {
      loadDjs();
    }
  }, []);

  async function loadDjs() {
    try {
      const response = await apiFetch("/v1/admin/djs");
      if (response.ok) {
        const data = await response.json();
        setDjs(data.items || []);
      }
    } catch (err) {
      console.error("Failed to load DJs:", err);
    }
  }

  async function handleLinkDj() {
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiFetch("/v1/admin/auth/link-dj", {
        method: "POST",
        body: JSON.stringify({ djId: linkedDjId ? parseInt(linkedDjId) : null }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to link DJ");
      }

      setSuccess(linkedDjId ? "DJ linked successfully" : "DJ unlinked successfully");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  function getRoleLabel(role) {
    switch (role) {
      case "super_admin":
        return "Super Admin";
      case "admin":
        return "Admin";
      case "dj":
        return "DJ";
      default:
        return role;
    }
  }

  if (!user) {
    return (
      <section className="user-profile-shell">
        <p>Loading user profile...</p>
      </section>
    );
  }

  return (
    <section className="user-profile-shell">
      <h2>User Profile</h2>
      <p className="subhead">Manage your account settings and DJ association.</p>

      <div className="profile-cards">
        <article className="profile-card">
          <h3>Account Information</h3>
          <div className="profile-info">
            <div className="info-row">
              <label>Email</label>
              <span>{user.email}</span>
            </div>
            <div className="info-row">
              <label>Role</label>
              <span className={`role-badge role-${user.role}`}>
                {getRoleLabel(user.role)}
              </span>
            </div>
            <div className="info-row">
              <label>Status</label>
              <span className={`status-badge status-${user.status}`}>
                {user.status}
              </span>
            </div>
            <div className="info-row">
              <label>Member Since</label>
              <span>{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "N/A"}</span>
            </div>
            <div className="info-row">
              <label>Last Login</label>
              <span>
                {user.lastLoginAt
                  ? new Date(user.lastLoginAt).toLocaleString()
                  : "Never"}
              </span>
            </div>
          </div>
        </article>

        {hasRole("dj") && (
          <article className="profile-card">
            <h3>DJ Association</h3>
            <p className="subhead">Link your account to a DJ profile.</p>

            <div className="form-group">
              <label htmlFor="dj-select">Select DJ Profile</label>
              <select
                id="dj-select"
                value={linkedDjId}
                onChange={(e) => setLinkedDjId(e.target.value)}
              >
                <option value="">Not linked</option>
                {djs.map((dj) => (
                  <option key={dj.id} value={dj.id}>
                    {dj.name}
                  </option>
                ))}
              </select>
            </div>

            {error && <div className="error-message">{error}</div>}
            {success && <div className="success-message">{success}</div>}

            <div className="profile-actions">
              <button
                className="primary"
                onClick={handleLinkDj}
                disabled={isLoading}
              >
                {isLoading ? "Saving..." : linkedDjId ? "Link DJ" : "Unlink DJ"}
              </button>
            </div>
          </article>
        )}

        <article className="profile-card">
          <h3>Security</h3>
          <p className="subhead">Manage your account security settings.</p>

          <div className="profile-actions">
            <button
              className="primary"
              onClick={() => setChangePasswordOpen(true)}
            >
              Change Password
            </button>
          </div>
        </article>
      </div>

      <ChangePasswordDialog
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />
    </section>
  );
}
