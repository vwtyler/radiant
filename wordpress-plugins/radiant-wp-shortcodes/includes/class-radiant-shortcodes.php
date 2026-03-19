<?php

if (!defined('ABSPATH')) {
    exit;
}

class Radiant_Shortcodes
{
    public static function init()
    {
        add_shortcode('radiant_schedule_grid', [__CLASS__, 'shortcode_schedule_grid']);
        add_shortcode('radiant_current_show', [__CLASS__, 'shortcode_current_show']);
        add_shortcode('radiant_now_playing', [__CLASS__, 'shortcode_current_show']);
        add_shortcode('radiant_schedule_day', [__CLASS__, 'shortcode_schedule_day']);
        add_shortcode('radiant_schedule_week', [__CLASS__, 'shortcode_schedule_week']);
        add_shortcode('radiant_playlist_recent', [__CLASS__, 'shortcode_playlist_recent']);

        add_filter('the_posts', [__CLASS__, 'conditionally_enqueue_assets'], 20, 2);
        add_action('wp_ajax_radiant_wp_proxy', [__CLASS__, 'ajax_proxy']);
        add_action('wp_ajax_nopriv_radiant_wp_proxy', [__CLASS__, 'ajax_proxy']);
    }

    public static function conditionally_enqueue_assets($posts)
    {
        $settings = Radiant_Settings::get();
        $loadCss = !empty($settings['load_css']);
        if (!is_array($posts)) {
            return $posts;
        }

        $needles = [
            '[radiant_schedule_grid',
            '[radiant_current_show',
            '[radiant_now_playing',
            '[radiant_schedule_day',
            '[radiant_schedule_week',
            '[radiant_playlist_recent',
        ];

        $found = false;
        $foundGrid = false;
        foreach ($posts as $post) {
            if (!isset($post->post_content)) {
                continue;
            }
            foreach ($needles as $needle) {
                if (strpos($post->post_content, $needle) !== false) {
                    $found = true;
                    if ($needle === '[radiant_schedule_grid') {
                        $foundGrid = true;
                    }
                }
            }
        }

        if (!$found) {
            return $posts;
        }

        if ($loadCss) {
            wp_enqueue_style(
                'radiant-wp-shortcodes',
                RADIANT_WP_SHORTCODES_URL . 'assets/radiant-shortcodes.css',
                [],
                RADIANT_WP_SHORTCODES_VERSION
            );
        }

        if ($foundGrid) {
            wp_enqueue_script(
                'radiant-wp-schedule-grid',
                RADIANT_WP_SHORTCODES_URL . 'assets/radiant-schedule-grid.js',
                [],
                RADIANT_WP_SHORTCODES_VERSION,
                true
            );

            $settings = Radiant_Settings::get();
            wp_localize_script('radiant-wp-schedule-grid', 'radiantWpGridConfig', [
                'apiBaseUrl' => isset($settings['api_base_url']) ? (string) $settings['api_base_url'] : '',
                'defaultTimezone' => self::default_timezone(),
                'proxyUrl' => admin_url('admin-ajax.php', 'relative'),
            ]);
        }

        return $posts;
    }

    public static function shortcode_schedule_grid($atts)
    {
        $atts = shortcode_atts([
            'view' => 'week',
            'tz' => self::default_timezone(),
            'show_toggle' => '1',
            'show_live' => '1',
        ], $atts, 'radiant_schedule_grid');

        $view = strtolower(trim((string) $atts['view'])) === 'day' ? 'day' : 'week';
        $tz = trim((string) $atts['tz']);
        if ($tz === '') {
            $tz = self::default_timezone();
        }

        $instanceId = 'radiant-grid-' . wp_generate_password(8, false, false);

        ob_start();
        ?>
        <div
            id="<?php echo esc_attr($instanceId); ?>"
            class="radiant-grid-root"
            data-default-view="<?php echo esc_attr($view); ?>"
            data-timezone="<?php echo esc_attr($tz); ?>"
            data-show-toggle="<?php echo esc_attr(!empty($atts['show_toggle']) ? '1' : '0'); ?>"
            data-show-live="<?php echo esc_attr(!empty($atts['show_live']) ? '1' : '0'); ?>"
        >
            <div class="radiant-grid-loading">Loading schedule...</div>
        </div>
        <?php
        return ob_get_clean();
    }

    public static function ajax_proxy()
    {
        $path = isset($_GET['radiant_path']) ? wp_unslash((string) $_GET['radiant_path']) : '';
        if (!self::is_allowed_proxy_path($path)) {
            wp_send_json_error([
                'message' => 'Unsupported API path.',
            ], 400);
        }

        $query = $_GET;
        unset($query['action'], $query['radiant_path']);

        $payload = Radiant_Api_Client::get_json($path, $query);
        if (is_wp_error($payload)) {
            $status = 500;
            $errorData = $payload->get_error_data();
            if (is_array($errorData) && isset($errorData['status']) && is_numeric($errorData['status'])) {
                $status = (int) $errorData['status'];
            }

            wp_send_json_error([
                'message' => $payload->get_error_message(),
            ], $status);
        }

        wp_send_json_success($payload);
    }

    private static function is_allowed_proxy_path($path)
    {
        $clean = trim((string) $path);
        if ($clean === '') {
            return false;
        }

        if (preg_match('#^/v1/(schedule|now-playing|playlist/recent)$#', $clean)) {
            return true;
        }

        if (preg_match('#^/v1/shows/[A-Za-z0-9._~-]+$#', $clean)) {
            return true;
        }

        if (preg_match('#^/v1/shows/[A-Za-z0-9._~-]+/insights$#', $clean)) {
            return true;
        }

        return false;
    }

    public static function shortcode_current_show($atts)
    {
        $atts = shortcode_atts([
            'tz' => self::default_timezone(),
            'show_track' => '1',
            'show_artwork' => '0',
        ], $atts, 'radiant_current_show');

        $data = Radiant_Api_Client::get_json('/v1/now-playing', ['tz' => $atts['tz']]);
        if (is_wp_error($data)) {
            return self::render_error($data->get_error_message());
        }

        $show = isset($data['show']) && is_array($data['show']) ? $data['show'] : [];
        $track = isset($data['track']) && is_array($data['track']) ? $data['track'] : null;

        ob_start();
        ?>
        <div class="radiant-widget radiant-current-show">
            <h3 class="radiant-title">On Air</h3>
            <p class="radiant-show-name"><?php echo esc_html(!empty($show['title']) ? $show['title'] : 'No scheduled show right now'); ?></p>
            <?php if (!empty($atts['show_track']) && $track): ?>
                <p class="radiant-track">
                    <?php
                    $artist = isset($track['artist']) ? trim((string) $track['artist']) : '';
                    $title = isset($track['title']) ? trim((string) $track['title']) : '';
                    $line = trim($artist . ($artist && $title ? ' - ' : '') . $title);
                    echo esc_html($line !== '' ? $line : 'Track metadata unavailable');
                    ?>
                </p>
            <?php endif; ?>
            <?php if (!empty($atts['show_artwork']) && $track && !empty($track['artwork_url'])): ?>
                <img class="radiant-artwork" src="<?php echo esc_url($track['artwork_url']); ?>" alt="Track artwork" />
            <?php endif; ?>
        </div>
        <?php
        return ob_get_clean();
    }

    public static function shortcode_schedule_day($atts)
    {
        $atts = shortcode_atts([
            'day' => 'today',
            'tz' => self::default_timezone(),
            'show_overrides' => '1',
        ], $atts, 'radiant_schedule_day');

        $data = Radiant_Api_Client::get_json('/v1/schedule', ['tz' => $atts['tz']]);
        if (is_wp_error($data)) {
            return self::render_error($data->get_error_message());
        }

        $days = isset($data['days']) && is_array($data['days']) ? $data['days'] : [];
        $target = self::resolve_target_day($days, $atts['day'], $atts['tz']);
        if (!$target) {
            return self::render_error('No schedule available for this day.');
        }

        ob_start();
        ?>
        <div class="radiant-widget radiant-schedule-day">
            <h3 class="radiant-title"><?php echo esc_html($target['weekday_name']); ?></h3>
            <ul class="radiant-list">
                <?php foreach ((array) $target['slots'] as $slot): ?>
                    <li>
                        <span class="radiant-time"><?php echo esc_html(self::format_time_range($slot)); ?></span>
                        <span class="radiant-item-title"><?php echo esc_html(self::slot_show_title($slot)); ?></span>
                    </li>
                <?php endforeach; ?>
            </ul>
            <?php if (!empty($atts['show_overrides']) && !empty($target['overrides'])): ?>
                <p class="radiant-subtitle">Overrides</p>
                <ul class="radiant-list compact">
                    <?php foreach ((array) $target['overrides'] as $override): ?>
                        <li><?php echo esc_html(self::override_line($override)); ?></li>
                    <?php endforeach; ?>
                </ul>
            <?php endif; ?>
        </div>
        <?php
        return ob_get_clean();
    }

    public static function shortcode_schedule_week($atts)
    {
        $atts = shortcode_atts([
            'tz' => self::default_timezone(),
            'show_empty' => '1',
        ], $atts, 'radiant_schedule_week');

        $data = Radiant_Api_Client::get_json('/v1/schedule', ['tz' => $atts['tz']]);
        if (is_wp_error($data)) {
            return self::render_error($data->get_error_message());
        }

        $days = isset($data['days']) && is_array($data['days']) ? $data['days'] : [];
        usort($days, function ($a, $b) {
            $order = [7 => 0, 1 => 1, 2 => 2, 3 => 3, 4 => 4, 5 => 5, 6 => 6];
            $aDay = isset($a['weekday']) ? (int) $a['weekday'] : 0;
            $bDay = isset($b['weekday']) ? (int) $b['weekday'] : 0;
            return ($order[$aDay] ?? 99) <=> ($order[$bDay] ?? 99);
        });

        ob_start();
        ?>
        <div class="radiant-widget radiant-schedule-week">
            <div class="radiant-week-grid">
                <?php foreach ($days as $day): ?>
                    <?php if (empty($atts['show_empty']) && empty($day['slots'])) {
                        continue;
                    } ?>
                    <section class="radiant-day-card">
                        <h4 class="radiant-day-title"><?php echo esc_html(self::short_weekday_label($day)); ?></h4>
                        <div class="radiant-day-body" style="height: <?php echo esc_attr((string) self::week_day_body_height_px()); ?>px;">
                            <?php foreach (self::week_hour_markers() as $markerMinute): ?>
                                <div class="radiant-hour-line" style="top: <?php echo esc_attr((string) self::visual_minute_to_px($markerMinute)); ?>px;"></div>
                            <?php endforeach; ?>

                            <?php if (!empty($day['slots'])): ?>
                                <?php foreach ((array) $day['slots'] as $slot): ?>
                                    <article class="radiant-slot-card" style="<?php echo esc_attr(self::slot_style($slot)); ?>" tabindex="0">
                                        <span class="radiant-time"><?php echo esc_html(self::format_time_range($slot)); ?></span>
                                        <span class="radiant-item-title"><?php echo esc_html(self::slot_show_title($slot)); ?></span>
                                        <span class="radiant-slot-tooltip" role="note">
                                            <strong class="radiant-tooltip-title"><?php echo esc_html(self::slot_show_title($slot)); ?></strong>
                                            <span class="radiant-tooltip-time"><?php echo esc_html(self::format_time_range($slot)); ?></span>
                                        </span>
                                    </article>
                                <?php endforeach; ?>
                            <?php else: ?>
                                <p class="radiant-empty">No scheduled slots</p>
                            <?php endif; ?>
                        </div>
                    </section>
                <?php endforeach; ?>
            </div>
        </div>
        <?php
        return ob_get_clean();
    }

    public static function shortcode_playlist_recent($atts)
    {
        $atts = shortcode_atts([
            'limit' => '10',
        ], $atts, 'radiant_playlist_recent');

        $limit = (int) $atts['limit'];
        if ($limit < 1) {
            $limit = 10;
        }
        if ($limit > 50) {
            $limit = 50;
        }

        $data = Radiant_Api_Client::get_json('/v1/playlist/recent', ['limit' => $limit]);
        if (is_wp_error($data)) {
            return self::render_error($data->get_error_message());
        }

        $items = isset($data['items']) && is_array($data['items']) ? $data['items'] : [];

        ob_start();
        ?>
        <div class="radiant-widget radiant-playlist-recent">
            <h3 class="radiant-title">Recently Played</h3>
            <ul class="radiant-list">
                <?php foreach ($items as $item): ?>
                    <li>
                        <span class="radiant-item-title"><?php echo esc_html(self::artist_title($item)); ?></span>
                        <?php if (!empty($item['show']['title'])): ?>
                            <span class="radiant-meta">on <?php echo esc_html($item['show']['title']); ?></span>
                        <?php endif; ?>
                    </li>
                <?php endforeach; ?>
            </ul>
        </div>
        <?php
        return ob_get_clean();
    }

    private static function default_timezone()
    {
        $settings = Radiant_Settings::get();
        return !empty($settings['timezone']) ? (string) $settings['timezone'] : 'America/Los_Angeles';
    }

    private static function resolve_target_day($days, $dayAttr, $timezone)
    {
        if (!is_array($days) || !$days) {
            return null;
        }

        $needle = strtolower(trim((string) $dayAttr));
        $map = [
            'mon' => 1,
            'monday' => 1,
            'tue' => 2,
            'tuesday' => 2,
            'wed' => 3,
            'wednesday' => 3,
            'thu' => 4,
            'thursday' => 4,
            'fri' => 5,
            'friday' => 5,
            'sat' => 6,
            'saturday' => 6,
            'sun' => 7,
            'sunday' => 7,
        ];

        if ($needle === '' || $needle === 'today') {
            $now = new DateTime('now', new DateTimeZone($timezone));
            $targetWeekday = (int) $now->format('N');
        } elseif (isset($map[$needle])) {
            $targetWeekday = $map[$needle];
        } else {
            $targetWeekday = (int) $needle;
        }

        foreach ($days as $day) {
            if ((int) ($day['weekday'] ?? 0) === $targetWeekday) {
                return $day;
            }
        }

        return null;
    }

    private static function slot_show_title($slot)
    {
        if (!isset($slot['show']) || !is_array($slot['show'])) {
            return 'Unassigned Show';
        }
        return !empty($slot['show']['title']) ? (string) $slot['show']['title'] : 'Unassigned Show';
    }

    private static function format_time_range($slot)
    {
        $start = isset($slot['start_time']) ? self::format_hhmm((string) $slot['start_time']) : '';
        $end = isset($slot['end_time']) ? self::format_hhmm((string) $slot['end_time']) : '';
        return trim($start . ($start && $end ? ' - ' : '') . $end);
    }

    private static function format_hhmm($time)
    {
        $dt = DateTime::createFromFormat('H:i', $time);
        if (!$dt) {
            return $time;
        }
        return $dt->format('g:i A');
    }

    private static function short_weekday_label($day)
    {
        $weekday = isset($day['weekday']) ? (int) $day['weekday'] : 0;
        $map = [
            1 => 'Mon',
            2 => 'Tue',
            3 => 'Wed',
            4 => 'Thu',
            5 => 'Fri',
            6 => 'Sat',
            7 => 'Sun',
        ];
        if (isset($map[$weekday])) {
            return $map[$weekday];
        }
        $fallback = isset($day['weekday_name']) ? trim((string) $day['weekday_name']) : '';
        if ($fallback === '') {
            return 'Day';
        }
        return substr($fallback, 0, 3);
    }

    private static function parse_hhmm_minutes($time)
    {
        $parts = explode(':', (string) $time);
        $h = isset($parts[0]) ? (int) $parts[0] : 0;
        $m = isset($parts[1]) ? (int) $parts[1] : 0;
        if ($h < 0 || $h > 24 || $m < 0 || $m > 59) {
            return 0;
        }
        if ($h === 24) {
            return 24 * 60;
        }
        return ($h * 60) + $m;
    }

    private static function week_px_per_minute()
    {
        return 1.2;
    }

    private static function compressed_block_end_minutes()
    {
        return 7 * 60;
    }

    private static function compressed_block_visual_minutes()
    {
        return 60;
    }

    private static function visual_day_minutes()
    {
        return self::compressed_block_visual_minutes() + (24 * 60 - self::compressed_block_end_minutes());
    }

    private static function week_day_body_height_px()
    {
        return (int) round(self::visual_day_minutes() * self::week_px_per_minute());
    }

    private static function visual_minute($minute)
    {
        $minute = max(0, min(24 * 60, (int) $minute));
        $compressedEnd = self::compressed_block_end_minutes();
        $compressedVisual = self::compressed_block_visual_minutes();

        if ($minute <= $compressedEnd) {
            return ($minute / $compressedEnd) * $compressedVisual;
        }

        return $compressedVisual + ($minute - $compressedEnd);
    }

    private static function visual_minute_to_px($minute)
    {
        return (int) round(self::visual_minute($minute) * self::week_px_per_minute());
    }

    private static function visual_duration_minutes($startMinute, $durationMinutes)
    {
        $start = max(0, min(24 * 60, (int) $startMinute));
        $end = max(0, min(24 * 60, $start + max(0, (int) $durationMinutes)));
        $startVisual = self::visual_minute($start);
        $endVisual = self::visual_minute($end);
        return max(0, $endVisual - $startVisual);
    }

    private static function week_hour_markers()
    {
        $markers = [0, self::compressed_block_end_minutes()];
        for ($hour = 8; $hour <= 24; $hour++) {
            $markers[] = $hour * 60;
        }
        return $markers;
    }

    private static function slot_style($slot)
    {
        $start = self::parse_hhmm_minutes(isset($slot['start_time']) ? (string) $slot['start_time'] : '00:00');
        $end = self::parse_hhmm_minutes(isset($slot['end_time']) ? (string) $slot['end_time'] : '00:00');

        if ($end > $start) {
            $duration = $end - $start;
        } elseif ($end === 0 && $start > 0) {
            $duration = (24 * 60) - $start;
        } else {
            $duration = 30;
        }

        $top = self::visual_minute_to_px($start);
        $height = (int) round(max(self::visual_duration_minutes($start, $duration) * self::week_px_per_minute(), 36));

        return 'top: ' . $top . 'px; height: ' . $height . 'px;';
    }

    private static function override_line($override)
    {
        $showTitle = 'Override';
        if (!empty($override['show']) && is_array($override['show']) && !empty($override['show']['title'])) {
            $showTitle = (string) $override['show']['title'];
        }

        $start = isset($override['start_at']) ? (string) $override['start_at'] : '';
        $startText = $start !== '' ? gmdate('M j, g:i A', strtotime($start)) : '';
        return trim($startText . ($startText ? ': ' : '') . $showTitle);
    }

    private static function artist_title($item)
    {
        $artist = isset($item['artist']) ? trim((string) $item['artist']) : '';
        $title = isset($item['title']) ? trim((string) $item['title']) : '';
        $line = trim($artist . ($artist && $title ? ' - ' : '') . $title);
        return $line !== '' ? $line : 'Unknown track';
    }

    private static function render_error($message)
    {
        return '<div class="radiant-widget radiant-error">' . esc_html($message) . '</div>';
    }
}
