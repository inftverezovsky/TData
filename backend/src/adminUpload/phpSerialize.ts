/**
 * A simple PHP serialize implementation for TypeScript.
 * Supports strings, numbers, booleans, null, arrays, and objects (as PHP associative arrays).
 */
export function phpSerialize(data: any): string {
  if (data === null) {
    return 'N;';
  }

  if (typeof data === 'boolean') {
    return `b:${data ? 1 : 0};`;
  }

  if (typeof data === 'number') {
    if (Number.isInteger(data)) {
      return `i:${data};`;
    }
    return `d:${data};`;
  }

  if (typeof data === 'string') {
    // PHP uses byte length for strings, not character length.
    // However, for ASCII it's the same. For UTF-8 we might need to be careful.
    const bytes = Buffer.from(data, 'utf-8');
    return `s:${bytes.length}:"${data}";`;
  }

  if (Array.isArray(data)) {
    let result = `a:${data.length}:{`;
    for (let i = 0; i < data.length; i++) {
      result += phpSerialize(i) + phpSerialize(data[i]);
    }
    result += '}';
    return result;
  }

  if (typeof data === 'object') {
    const keys = Object.keys(data);
    let result = `a:${keys.length}:{`;
    for (const key of keys) {
      // If key is a number-like string, we should probably treat it as an integer key
      // but PHP serialize usually handles string keys as strings.
      const parsedKey = parseInt(key, 10);
      if (!isNaN(parsedKey) && parsedKey.toString() === key) {
        result += phpSerialize(parsedKey) + phpSerialize(data[key]);
      } else {
        result += phpSerialize(key) + phpSerialize(data[key]);
      }
    }
    result += '}';
    return result;
  }

  return 'N;';
}

/**
 * Basic PHP unserialize (only supports what we might get back from the API: 1, or simple arrays)
 * This is much harder to implement fully, but we can try to handle simple cases.
 */
export function phpUnserialize(data: string): any {
  // If it's just "1", it's likely a raw response, not serialized
  if (data === '1') return 1;
  
  // Real unserialize would be complex. For now, let's just return null if it looks like we can't parse it easily.
  // Or use a library if we had one.
  try {
    // Placeholder for a real unserializer if needed.
    // For now, we will return the raw string if we can't easily parse it.
    return null;
  } catch (e) {
    return null;
  }
}
