function timestamp(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
export function formatTranscript(items, format) {
  if (format === 'txt') return items.map((item) => `${item.source}\n${item.text}`).join('\n\n');
  // Each capture session uses a monotonic clock. Export at wall-clock offsets so repeated sessions cannot overlap.
  const origin = items[0]?.receivedAt ?? 0;
  let previousEnd = 0;
  return items.map((item, index) => {
    const duration = Math.max(1, item.end - item.start);
    const start = Math.max(previousEnd, (item.receivedAt - origin) / 1000);
    const end = start + duration;
    previousEnd = end;
    return `${index + 1}\n${timestamp(start)} --> ${timestamp(end)}\n${item.text}\n`;
  }).join('\n');
}
