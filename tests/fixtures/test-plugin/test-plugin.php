<?php
/**
 * Plugin Name: WP API Test Plugin
 * Description: A minimal test plugin for wp-api plugin upload testing.
 * Version: 1.0.0
 * Requires at least: 5.5
 * Requires PHP: 7.4
 */

function wpat_test_init(): void {
  add_shortcode('wpat_hello', function (): string {
    return 'Hello from WP API Test Plugin v' . WPAT_VERSION;
  });
}

define('WPAT_VERSION', '1.0.0');

add_action('init', 'wpat_test_init');
