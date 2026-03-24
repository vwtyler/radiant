import React, { useState, useEffect } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

function getApiBase() {
  if (API_BASE_URL && !API_BASE_URL.includes("localhost")) {
    return API_BASE_URL;
  }
  const { protocol, hostname } = window.location;
  const inferredHost = hostname.includes("admin")
    ? hostname.replace("admin.", "api.").replace("-admin.", "-api.").replace("admin-", "api-")
    : hostname;
  return `${protocol}//${inferredHost}`;
}

export function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState([]);

  // Extract token from URL query params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get("token");
    if (tokenFromUrl) {
      setToken(tokenFromUrl);
    }
  }, []);

  function validatePassword(pass) {
    const errors = [];
    if (pass.length < 8) {
      errors.push("At least 8 characters");
    }
    if (!/[A-Z]/.test(pass)) {
      errors.push("One uppercase letter");
    }
    if (!/[a-z]/.test(pass)) {
      errors.push("One lowercase letter");
    }
    if (!/[0-9]/.test(pass)) {
      errors.push("One number");
    }
    return errors;
  }

  function handlePasswordChange(e) {
    const newPassword = e.target.value;
    setPassword(newPassword);
    setPasswordErrors(validatePassword(newPassword));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError("Invalid reset link. Please request a new password reset.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    const errors = validatePassword(password);
    if (errors.length > 0) {
      setError(`Password must have: ${errors.join(", ")}`);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${getApiBase()}/v1/admin/auth/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to reset password");
      } else {
        setSuccess(true);
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  if (success) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Password Reset!</h1>
          <p>Your password has been reset successfully.</p>
          <button 
            className="primary"
            onClick={() => window.location.href = "/"}
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>KAAD-LP Admin</h1>
        <h2>Set New Password</h2>
        <p>Enter your new password below.</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="password">New Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={handlePasswordChange}
              required
              placeholder="Create a secure password"
            />
            {passwordErrors.length > 0 && (
              <ul className="password-requirements">
                {passwordErrors.map((err, i) => (
                  <li key={i} className="requirement-missing">{err}</li>
                ))}
              </ul>
            )}
            {passwordErrors.length === 0 && password && (
              <p className="password-valid">✓ Password meets all requirements</p>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="confirm-password">Confirm Password</label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              placeholder="Confirm your password"
            />
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <button 
            type="submit" 
            className="primary"
            disabled={isLoading || passwordErrors.length > 0}
          >
            {isLoading ? "Resetting..." : "Reset Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
