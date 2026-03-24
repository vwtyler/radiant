import React, { useState } from "react";
import { useAuth, useApi } from "./AuthContext";

export function InviteModal({ open, onClose, onInvite }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("dj");
  const [djId, setDjId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const { hasRole } = useAuth();
  const { apiFetch } = useApi();

  // Only super_admins and admins can invite
  const canInvite = hasRole("admin");

  if (!open || !canInvite) return null;

  async function handleSubmit(event) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiFetch("/v1/admin/auth/invite", {
        method: "POST",
        body: JSON.stringify({
          email,
          role,
          djId: djId ? Number(djId) : null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to send invitation");
      } else {
        setSuccess(`Invitation sent to ${email}`);
        setEmail("");
        setDjId("");
        if (onInvite) onInvite(data);
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h2>Invite User</h2>
        <p className="subhead">Send an invitation email to add a new admin or DJ.</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="invite-email">Email</label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="user@example.com"
            />
          </div>

          <div className="form-group">
            <label htmlFor="invite-role">Role</label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="admin">Admin</option>
              <option value="dj">DJ</option>
            </select>
          </div>

          {role === "dj" && (
            <div className="form-group">
              <label htmlFor="invite-dj-id">DJ ID (optional)</label>
              <input
                id="invite-dj-id"
                type="number"
                value={djId}
                onChange={(e) => setDjId(e.target.value)}
                placeholder="Link to existing DJ record"
              />
            </div>
          )}

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {success && (
            <div className="success-message">
              {success}
            </div>
          )}

          <div className="modal-actions">
            <button 
              type="button" 
              className="ghost"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="primary"
              disabled={isLoading}
            >
              {isLoading ? "Sending..." : "Send Invitation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
