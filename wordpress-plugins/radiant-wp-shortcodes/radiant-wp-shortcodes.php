<?php
/**
 * Plugin Name: Radiant WP Shortcodes
 * Description: Shortcodes for current show, daily/weekly schedule, and recent playlist from Radiant API.
 * Version: 0.2.3
 * Author: Radiant
 * License: GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
    exit;
}

define('RADIANT_WP_SHORTCODES_VERSION', '0.2.3');
define('RADIANT_WP_SHORTCODES_FILE', __FILE__);
define('RADIANT_WP_SHORTCODES_DIR', plugin_dir_path(__FILE__));
define('RADIANT_WP_SHORTCODES_URL', plugin_dir_url(__FILE__));

require_once RADIANT_WP_SHORTCODES_DIR . 'includes/class-radiant-settings.php';
require_once RADIANT_WP_SHORTCODES_DIR . 'includes/class-radiant-api-client.php';
require_once RADIANT_WP_SHORTCODES_DIR . 'includes/class-radiant-shortcodes.php';

function radiant_wp_shortcodes_activate()
{
    if (!get_option(Radiant_Settings::OPTION_NAME)) {
        add_option(Radiant_Settings::OPTION_NAME, Radiant_Settings::defaults());
    }
}

register_activation_hook(__FILE__, 'radiant_wp_shortcodes_activate');

add_action('plugins_loaded', function () {
    Radiant_Settings::init();
    Radiant_Shortcodes::init();
});
