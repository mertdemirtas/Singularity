'use strict';

function splitBounds(width, minLeft, minRight) {
  const available = Math.max(0, width - 5);
  return { available, min: minLeft, max: Math.max(minLeft, available - minRight), enabled: available >= minLeft + minRight };
}

function createGitSplitter(container, handle, { variable, value = .36, minLeft = 180, minRight = 220, onChange, orientation = 'vertical' }) {
  let fraction = value, dragging = false, frame, pointer;
  const horizontal = orientation === 'horizontal';
  const size = () => horizontal ? container.clientHeight : container.clientWidth;
  const coordinate = event => horizontal ? event.clientY : event.clientX;
  const start = () => horizontal ? container.getBoundingClientRect().top : container.getBoundingClientRect().left;
  handle.classList.add('plain-git-splitter'); handle.tabIndex = 0;
  handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', orientation);
  const apply = pixels => {
    const bounds = splitBounds(size(), minLeft, minRight);
    handle.setAttribute('aria-disabled', String(!bounds.enabled));
    if (!bounds.enabled) return;
    const left = Math.max(bounds.min, Math.min(bounds.max, pixels ?? fraction * bounds.available));
    fraction = left / bounds.available;
    container.style.setProperty(variable, `calc((100% - 5px) * ${fraction})`);
    for (const [key, number] of [['min', bounds.min], ['max', bounds.max], ['now', left]]) handle.setAttribute(`aria-value${key}`, String(Math.round(number / bounds.available * 100)));
    onChange?.(fraction);
  };
  const finish = () => {
    if (!dragging) return;
    dragging = false; document.body.classList.remove('plain-git-resizing', 'plain-git-resizing-rows');
    if (frame) { cancelAnimationFrame(frame); frame = undefined; }
    if (pointer !== undefined && handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
  };
  const down = event => {
    if (event.button !== 0 || !splitBounds(size(), minLeft, minRight).enabled) return;
    event.preventDefault(); dragging = true; pointer = event.pointerId; handle.setPointerCapture(pointer); handle.focus(); document.body.classList.add('plain-git-resizing');
    if (horizontal) document.body.classList.add('plain-git-resizing-rows');
  };
  const move = event => {
    if (!dragging) return;
    const point = coordinate(event);
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { frame = undefined; apply(point - start()); });
  };
  const up = event => { if (dragging) apply(coordinate(event) - start()); finish(); };
  const key = event => {
    const previous = horizontal ? 'ArrowUp' : 'ArrowLeft', next = horizontal ? 'ArrowDown' : 'ArrowRight';
    if (![previous, next, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); const bounds = splitBounds(size(), minLeft, minRight);
    apply(event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : fraction * bounds.available + (event.key === previous ? -1 : 1) * (event.shiftKey ? 40 : 10));
  };
  const reset = () => { fraction = value; apply(); };
  handle.addEventListener('pointerdown', down); handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('lostpointercapture', finish); handle.addEventListener('keydown', key); handle.addEventListener('dblclick', reset);
  const observer = new ResizeObserver(() => apply()); observer.observe(container); apply();
  return { dispose() {
    finish(); observer.disconnect(); handle.removeEventListener('pointerdown', down); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('lostpointercapture', finish); handle.removeEventListener('keydown', key); handle.removeEventListener('dblclick', reset);
  } };
}

module.exports = { createGitSplitter, splitBounds };
