/**
 * @param {unknown} value
 * @returns {string | null} trimmed string, or null when value is not a string or is empty after trim
 */
function trimmedString(value) {
  if (typeof value !== "string") {
    return null;
  }
  return value.trim() || null;
}

module.exports = {
  trimmedString,
};
