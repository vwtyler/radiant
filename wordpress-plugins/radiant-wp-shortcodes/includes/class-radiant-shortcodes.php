<?php

if (!defined('ABSPATH')) {
    exit;
}

class Radiant_Shortcodes
{
    public static function init()
    {
        add_shortcode('radiant_current_show', [__CLASS__, 'shortcode_current_show']);
        add_shortcode('radiant_now_playing', [__CLASS__, 'shortcode_current_show']);
        add_shortcode('radiant_schedule_day', [__CLASS__, 'shortcode_schedule_day']);
        add_shortcode('radiant_schedule_week', [__CLASS__, 'shortcode_schedule_week']);
        add_shortcode('radiant_playlist_recent', [__CLASS__, 'shortcode_playlist_recent']);

        add_filter('the_posts', [__CLASS__, 'conditionally_enqueue_assets'], 20, 2);
    }

    public static function conditionally_enqueue_assets($posts)
    {
        $settings = Radiant_Settings::get();
        if (empty($settings['load_css']) || !is_array($posts)) {
            return $posts;
        }

        $needles = [
            '[radiant_current_show',
            '[radiant_now_playing',
            '[radiant_schedule_day',
            '[radiant_schedule_week',
            '[radiant_playlist_recent',
        ];

        foreach ($posts as $post) {
            if (!isset($post->post_content)) {
                continue;
            }
            foreach ($needles as $needle) {
                if (strpos($post->post_content, $needle) !== false) {
                    wp_enqueue_style(
                        'radiant-wp-shortcodes',
                        RADIANT_WP_SHORTCODES_URL . 'assets/radiant-shortcodes.css',
                        [],
                        RADIANT_WP_SHORTCODES_VERSION
                    );
                    return $posts;
                }
            }
        }

        return $posts;
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
            <div class="radiant-week-scroller">
            <div class="radiant-week-grid">
                <?php foreach ($days as $day): ?>
                    <?php if (empty($atts['show_empty']) && empty($day['slots'])) {
                        continue;
                    } ?>
                    <section class="radiant-day-card">
                        <h4 class="radiant-day-title"><?php echo esc_html($day['weekday_name']); ?></h4>
                        <?php if (!empty($day['slots'])): ?>
                            <ul class="radiant-list compact">
                                <?php foreach ((array) $day['slots'] as $slot): ?>
                                    <li class="radiant-slot-card">
                                        <span class="radiant-time"><?php echo esc_html(self::format_time_range($slot)); ?></span>
                                        <span class="radiant-item-title"><?php echo esc_html(self::slot_show_title($slot)); ?></span>
                                    </li>
                                <?php endforeach; ?>
                            </ul>
                        <?php else: ?>
                            <p class="radiant-empty">No scheduled slots</p>
                        <?php endif; ?>
                    </section>
                <?php endforeach; ?>
            </div>
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
