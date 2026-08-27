/**
 * A very small DOM helper layer.
 *
 * No framework, no innerHTML anywhere - elements and SVG icons are built from
 * real nodes, which keeps user-entered planet names safe by construction.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {string} tag
 * @param {object} [props]  class / dataset / style / aria-* / on<Event> handlers
 * @param {Array<Node|string>|Node|string} [children]
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  applyProps(node, props);
  append(node, children);
  return node;
}

export function applyProps(node, props) {
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== 'list' && typeof value !== 'object') {
      node[key] = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  return node;
}

export function append(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Line-art icons, drawn as real SVG nodes. */
const ICON_PATHS = {
  play: ['M8 5.5 18 12 8 18.5z'],
  pause: ['M9 5h2.5v14H9z', 'M12.5 5H15v14h-2.5z'],
  reverse: ['M11 6 4 12l7 6z', 'M20 6l-7 6 7 6z'],
  forward: ['M4 6l7 6-7 6z', 'M13 6l7 6-7 6z'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  trash: ['M5 7h14', 'M10 7V5h4v2', 'M7 7l1 12h8l1-12', 'M10.5 10v6', 'M13.5 10v6'],
  target: ['M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3'],
  circle: [],
  restart: ['M4.5 12a7.5 7.5 0 1 0 2.4-5.5', 'M4 4v4h4'],
  help: ['M9.2 9a2.8 2.8 0 1 1 3.6 2.7c-.8.3-1.3 1-1.3 1.9v.4', 'M12 17.6v.2'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  save: ['M5 5h11l3 3v11H5z', 'M8 5v5h7V5', 'M8 19v-5h8v5'],
  upload: ['M12 16V5', 'M8 9l4-4 4 4', 'M5 17v2h14v-2'],
  camera: ['M4 8h4l1.5-2h5L16 8h4v11H4z', 'M12 16.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z'],
  moon: ['M17 13.5A6.5 6.5 0 0 1 9 6a7 7 0 1 0 8 7.5z'],
  sliders: ['M5 8h9', 'M18 8h1', 'M5 16h3', 'M12 16h7', 'M15 5v6', 'M9 13v6'],
  chevron: ['M9 6l6 6-6 6'],
};

export function icon(name, { size = 18, filled = false } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');

  if (name === 'circle') {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '6');
    circle.setAttribute('fill', 'currentColor');
    svg.appendChild(circle);
    return svg;
  }

  for (const d of ICON_PATHS[name] ?? []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    if (filled || name === 'play' || name === 'pause' || name === 'reverse' || name === 'forward') {
      path.setAttribute('fill', 'currentColor');
    } else {
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.7');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
    }
    svg.appendChild(path);
  }
  return svg;
}

/**
 * A button with an optional icon and label.
 * @returns {HTMLButtonElement}
 */
export function button({ label, iconName, title, variant = '', onClick, ariaLabel, size }) {
  const node = el('button', {
    type: 'button',
    class: `btn ${variant}`.trim(),
    title: title ?? label,
    'aria-label': ariaLabel ?? (label ? undefined : title),
    onClick,
  });
  if (iconName) node.appendChild(icon(iconName, { size: size ?? 18 }));
  if (label) node.appendChild(el('span', { class: 'btn__label', text: label }));
  return node;
}
