<?php

if (!defined('ABSPATH')) {
    exit;
}

class Radiant_Settings
{
    const OPTION_NAME = 'radiant_wp_shortcodes_options';

    public static function init()
    {
        add_action('admin_init', [__CLASS__, 'register_settings']);
        add_action('admin_menu', [__CLASS__, 'register_menu']);
    }

    public static function defaults()
    {
        return [
            'api_base_url' => '',
            'timezone' => 'America/Los_Angeles',
            'cache_ttl' => 60,
            'load_css' => 1,
        ];
    }

    public static function get()
    {
        $saved = get_option(self::OPTION_NAME, []);
        return wp_parse_args(is_array($saved) ? $saved : [], self::defaults());
    }

    public static function register_menu()
    {
        add_options_page(
            'Radiant Shortcodes',
            'Radiant',
            'manage_options',
            'radiant-shortcodes',
            [__CLASS__, 'render_page']
        );
    }

    public static function register_settings()
    {
        register_setting(self::OPTION_NAME, self::OPTION_NAME, [
            'type' => 'array',
            'sanitize_callback' => [__CLASS__, 'sanitize'],
            'default' => self::defaults(),
        ]);

        add_settings_section(
            'radiant_main',
            'Radiant API Settings',
            function () {
                echo '<p>Configure how shortcodes connect to your Radiant API.</p>';
            },
            self::OPTION_NAME
        );

        add_settings_field('api_base_url', 'API Base URL', [__CLASS__, 'render_api_base_url'], self::OPTION_NAME, 'radiant_main');
        add_settings_field('timezone', 'Default Timezone', [__CLASS__, 'render_timezone'], self::OPTION_NAME, 'radiant_main');
        add_settings_field('cache_ttl', 'Cache TTL (seconds)', [__CLASS__, 'render_cache_ttl'], self::OPTION_NAME, 'radiant_main');
        add_settings_field('load_css', 'Load Default CSS', [__CLASS__, 'render_load_css'], self::OPTION_NAME, 'radiant_main');
    }

    public static function sanitize($input)
    {
        $defaults = self::defaults();
        $input = is_array($input) ? $input : [];

        $apiBaseUrl = isset($input['api_base_url']) ? esc_url_raw(trim((string) $input['api_base_url'])) : $defaults['api_base_url'];
        $timezone = isset($input['timezone']) ? sanitize_text_field((string) $input['timezone']) : $defaults['timezone'];
        $cacheTtl = isset($input['cache_ttl']) ? (int) $input['cache_ttl'] : $defaults['cache_ttl'];
        $loadCss = !empty($input['load_css']) ? 1 : 0;

        if ($cacheTtl < 0) {
            $cacheTtl = 0;
        }
        if ($cacheTtl > 3600) {
            $cacheTtl = 3600;
        }

        if (!in_array($timezone, timezone_identifiers_list(), true)) {
            $timezone = $defaults['timezone'];
        }

        return [
            'api_base_url' => $apiBaseUrl,
            'timezone' => $timezone,
            'cache_ttl' => $cacheTtl,
            'load_css' => $loadCss,
        ];
    }

    public static function render_page()
    {
        if (!current_user_can('manage_options')) {
            return;
        }
        ?>
        <div class="wrap">
            <h1>Radiant Shortcodes</h1>
            <form method="post" action="options.php">
                <?php
                settings_fields(self::OPTION_NAME);
                do_settings_sections(self::OPTION_NAME);
                submit_button();
                ?>
            </form>
        </div>
        <?php
    }

    public static function render_api_base_url()
    {
        $value = self::get()['api_base_url'];
        printf(
            '<input type="url" class="regular-text" name="%1$s[api_base_url]" value="%2$s" placeholder="https://api.example.org" />',
            esc_attr(self::OPTION_NAME),
            esc_attr($value)
        );
    }

    public static function render_timezone()
    {
        $value = self::get()['timezone'];
        printf(
            '<input type="text" class="regular-text" name="%1$s[timezone]" value="%2$s" placeholder="America/Los_Angeles" />',
            esc_attr(self::OPTION_NAME),
            esc_attr($value)
        );
    }

    public static function render_cache_ttl()
    {
        $value = (int) self::get()['cache_ttl'];
        printf(
            '<input type="number" min="0" max="3600" step="1" name="%1$s[cache_ttl]" value="%2$d" />',
            esc_attr(self::OPTION_NAME),
            $value
        );
    }

    public static function render_load_css()
    {
        $value = !empty(self::get()['load_css']);
        printf(
            '<label><input type="checkbox" name="%1$s[load_css]" value="1" %2$s /> Load plugin stylesheet on pages where shortcodes appear</label>',
            esc_attr(self::OPTION_NAME),
            checked($value, true, false)
        );
    }
}
