import { track } from '@vercel/analytics';

/**
 * Track custom events in Vercel Analytics.
 * Note: Custom events require Vercel Pro or Enterprise plan.
 * On Hobby plan, only pageviews and Speed Insights are available.
 */
export function trackEvent(
  name: string,
  props?: Record<string, string | number | boolean | null>
) {
  try {
    track(name, props);
  } catch {
    // Silently fail if analytics not available (e.g., Hobby plan)
  }
}

// Pre-defined event names for consistency
export const AnalyticsEvents = {
  PRODUCT_OPEN: 'product_open',
  WISHLIST_ADD: 'wishlist_add',
  BAG_ADD: 'bag_add',
  BUY_CLICK: 'buy_click',
  ROOMSCAN_START: 'roomscan_start',
  ROOMSCAN_SUCCESS: 'roomscan_success',
} as const;
