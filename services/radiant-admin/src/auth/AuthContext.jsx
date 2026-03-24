import React, { createContext, useContext, useEffect, useState } from "react";

const AuthContext = createContext(null);

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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check for existing session on mount
  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (token) {
      fetchUser(token);
    } else {
      setLoading(false);
    }
  }, []);

  async function fetchUser(token) {
    try {
      const response = await fetch(`${getApiBase()}/v1/admin/auth/me`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        // Token expired or invalid
        logout();
        return;
      }

      const data = await response.json();
      setUser(data);
    } catch (err) {
      console.error("Failed to fetch user:", err);
      logout();
    } finally {
      setLoading(false);
    }
  }

  async function login(email, password, rememberMe = false) {
    setError(null);
    try {
      const response = await fetch(`${getApiBase()}/v1/admin/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password, rememberMe }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Login failed");
        return false;
      }

      localStorage.setItem("accessToken", data.accessToken);
      if (data.refreshToken) {
        localStorage.setItem("refreshToken", data.refreshToken);
      }
      setUser(data.user);
      return true;
    } catch (err) {
      setError("Network error. Please try again.");
      return false;
    }
  }

  async function logout() {
    const token = localStorage.getItem("accessToken");
    if (token) {
      try {
        await fetch(`${getApiBase()}/v1/admin/auth/logout`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
      } catch (err) {
        // Ignore logout errors
      }
    }

    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    setUser(null);
  }

  async function refreshAccessToken() {
    const refreshToken = localStorage.getItem("refreshToken");
    if (!refreshToken) {
      logout();
      return false;
    }

    try {
      const response = await fetch(`${getApiBase()}/v1/admin/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        logout();
        return false;
      }

      localStorage.setItem("accessToken", data.accessToken);
      return true;
    } catch (err) {
      logout();
      return false;
    }
  }

  function hasRole(role) {
    if (!user) return false;
    if (role === "super_admin") return user.role === "super_admin";
    if (role === "admin") return user.role === "super_admin" || user.role === "admin";
    if (role === "dj") return user.role === "super_admin" || user.role === "admin" || user.role === "dj";
    return false;
  }

  const value = {
    user,
    loading,
    error,
    login,
    logout,
    refreshAccessToken,
    hasRole,
    isAuthenticated: !!user,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function useApi() {
  const { refreshAccessToken, logout } = useAuth();

  async function apiFetch(path, options = {}) {
    const token = localStorage.getItem("accessToken");
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    };

    const response = await fetch(`${getApiBase()}${path}`, {
      ...options,
      headers,
    });

    // Handle 401 by trying to refresh token
    if (response.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // Retry with new token
        const newToken = localStorage.getItem("accessToken");
        const retryResponse = await fetch(`${getApiBase()}${path}`, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${newToken}`,
            ...(options.headers || {}),
          },
        });
        return retryResponse;
      } else {
        logout();
      }
    }

    return response;
  }

  return { apiFetch };
}
