<?php

if (!defined('ABSPATH')) {
    exit;
}

class Radiant_Api_Client
{
    public static function get_json($path, $query = [], $ttl = null)
    {
        $settings = Radiant_Settings::get();
        $baseUrl = trim((string) $settings['api_base_url']);
        if ($baseUrl === '') {
            return new WP_Error('radiant_missing_base_url', 'Radiant API Base URL is not configured.');
        }

        $ttl = $ttl === null ? (int) $settings['cache_ttl'] : (int) $ttl;
        if ($ttl < 0) {
            $ttl = 0;
        }

        $query = is_array($query) ? $query : [];
        $url = untrailingslashit($baseUrl) . '/' . ltrim($path, '/');
        if (!empty($query)) {
            $url = add_query_arg($query, $url);
        }

        $cacheKey = 'radiant_api_' . md5($url);
        if ($ttl > 0) {
            $cached = get_transient($cacheKey);
            if ($cached !== false) {
                return $cached;
            }
        }

        $response = wp_remote_get($url, [
            'timeout' => 8,
            'headers' => [
                'Accept' => 'application/json',
            ],
        ]);

        if (is_wp_error($response)) {
            return $response;
        }

        $status = (int) wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        $json = json_decode($body, true);

        if ($status < 200 || $status >= 300) {
            $message = is_array($json) && !empty($json['message']) ? $json['message'] : 'Radiant API request failed.';
            return new WP_Error('radiant_http_error', $message, ['status' => $status]);
        }

        if (!is_array($json)) {
            return new WP_Error('radiant_invalid_json', 'Radiant API returned invalid JSON.');
        }

        if ($ttl > 0) {
            set_transient($cacheKey, $json, $ttl);
        }

        return $json;
    }
}
