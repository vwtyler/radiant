import React, { useState, useEffect } from "react";
import { useAuth, useApi } from "./AuthContext";

export function ChangePasswordDialog({ open, onClose }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState([]);
  const { apiFetch } = useApi();

  useEffect(() => {
    if (open) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError(null);
      setSuccess(false);
      setPasswordErrors([]);
    }
  }, [open]);

  function validatePassword(pass) {
    const errors = [];
    if (pass.length < 8) errors.push("At least 8 characters");
    if (!/[A-Z]/.test(pass)) errors.push("One uppercase letter");
    if (!/[a-z]/.test(pass)) errors.push("One lowercase letter");
    if (!/[0-9]/.test(pass)) errors.push("One number");
    return errors;
  }

  function handlePasswordChange(e) {
    const newPass = e.target.value;
    setNewPassword(newPass);
    setPasswordErrors(validatePassword(newPass));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    const errors = validatePassword(newPassword);
    if (errors.length > 0) {
      setError(`Password must have: ${errors.join(", ")}`);
      return;
    }

    setIsLoading(true);

    try {
      const response = await apiFetch("/v1/admin/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to change password");
      } else {
        setSuccess(true);
        setTimeout(() => {
          onClose();
        }, 2000);
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h2>Change Password</h2>

        {success ? (
          <div className="success-message">
            Password changed successfully!
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="current-password">Current Password</label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="new-password">New Password</label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={handlePasswordChange}
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
              <label htmlFor="confirm-password">Confirm New Password</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className="error-message">
                {error}
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
                disabled={isLoading || passwordErrors.length > 0}
              >
                {isLoading ? "Changing..." : "Change Password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
