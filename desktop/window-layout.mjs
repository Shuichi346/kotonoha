export function startupWindowLayout(area) {
  const margin = 16;
  const subtitleHeight = Math.min(240, Math.max(140, Math.round(area.height * 0.26)));
  const subtitleWidth = Math.min(1100, area.width - 48);
  const overlay = {
    width: subtitleWidth,
    height: subtitleHeight,
    x: area.x + Math.round((area.width - subtitleWidth) / 2),
    y: area.y + area.height - subtitleHeight - 40,
  };
  // Reserve a separate band above subtitles; users can resize or move either window later.
  const availableHeight = overlay.y - area.y - margin * 2;
  const height = Math.min(640, availableHeight);
  const width = Math.min(480, area.width - margin * 2);
  return {
    controller: {
      width, height,
      x: area.x + Math.round((area.width - width) / 2),
      y: area.y + margin + Math.round((availableHeight - height) / 2),
      minWidth: Math.min(450, width),
      minHeight: Math.min(420, height),
    },
    overlay,
  };
}
