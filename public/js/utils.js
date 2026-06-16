export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#039;";
      default:
        return character;
    }
  });
}

export function setMessage($element, message, tone = "neutral") {
  $element.text(message).attr("data-tone", tone);
}

/** Show a toast via `window.services.notifications` (initialized in app.js). */
export function notify(message, tone = "info") {
  if (!message) {
    return;
  }

  const notifications = window.services?.notifications;
  if (!notifications) {
    return;
  }

  const type =
    tone === "success" || tone === "error" || tone === "warning" || tone === "info"
      ? tone
      : "info";
  notifications[type](message);
}
