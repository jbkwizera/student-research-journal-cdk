/**
 * The app's short name.
 */
export const APP_SHORT_NAME = 'SRJ';

/**
 * Get a resource's name.
 *
 * @param prefix prefix
 * @param suffix suffix
 * @param separator optional separator
 */
export function getResourceName(prefix: string, suffix: string, separator: string = '-') {
  return [prefix, separator, suffix].join('');
}

/**
 * Get resource names prefix.
 *
 * @param accountId account ID
 * @param region region
 * @param separator optional separator
 */
export function getResourceNamePrefix(accountId?: string, region?: string, separator: string = '-') {
  return [
    APP_SHORT_NAME.toLowerCase(),
    asSuffix(accountId, separator),
    asSuffix(region, separator),
  ].join('');
}

// Format a string as part of a suffix, given a separator
const asSuffix = (str?: string, separator: string = '-') => str? `${separator}${str}` : '';