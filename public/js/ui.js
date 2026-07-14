const ICONS = {
  success: '✓',
  error: '!',
  info: 'ℹ'
};

let toastRegion = null;

function ensureToastRegion() {
  if (!toastRegion) {
    toastRegion = document.createElement('div');
    toastRegion.className = 'toast-region';
    toastRegion.setAttribute('role', 'status');
    toastRegion.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastRegion);
  }
  return toastRegion;
}

export function showToast(message, variant = 'info', duration = 4200) {
  const region = ensureToastRegion();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.dataset.variant = variant;

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = ICONS[variant] || ICONS.info;

  const text = document.createElement('span');
  text.textContent = message;

  toast.append(icon, text);
  region.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 500);
  }, duration);
  return toast;
}

export const CATEGORY_LABELS = {
  indian: 'Indian',
  western: 'Western'
};

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || 'Western';
}

/** Build a category chip element with an optional AI-attribution tooltip. */
export function categoryChip(track) {
  const chip = document.createElement('span');
  chip.className = `chip ${track.category === 'indian' ? 'indian' : 'western'}`;
  chip.textContent = categoryLabel(track.category);
  const via =
    track.categorySource === 'llm' ? 'Classified by AI' :
    track.categorySource === 'manual' ? 'Set manually' :
    'Auto-detected';
  chip.title = track.categoryReason ? `${via} — ${track.categoryReason}` : via;
  return chip;
}

export function formatTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
