/**
 * Form controls.
 *
 * Every numeric property gets both a slider and a typed input bound to the same
 * value, because dragging is right for exploring and typing is right for "make
 * it exactly one astronomical unit".
 */

import { clamp, fromLogSlider, toLogSlider } from '../utils/math.js';
import { el, button, icon } from './dom.js';

let uid = 0;
const nextId = (prefix) => `${prefix}-${(uid += 1)}`;

const RANGE_STEPS = 1000;

/**
 * A labelled slider + number input pair.
 *
 * @param {object} options
 * @param {string} options.label
 * @param {number} options.min       model units
 * @param {number} options.max       model units
 * @param {number} options.value     model units
 * @param {boolean} [options.log]    logarithmic slider travel
 * @param {number} [options.step]    linear step (ignored when log)
 * @param {string} [options.unit]    suffix shown next to the number input
 * @param {(v:number)=>number} [options.toDisplay]  model -> number input
 * @param {(v:number)=>number} [options.fromDisplay] number input -> model
 * @param {(v:number)=>string} [options.note]  helper line under the slider
 * @param {(v:number)=>void} options.onInput
 */
export function createSlider(options) {
  const {
    label,
    min,
    max,
    value,
    log = false,
    step = 0.01,
    unit = '',
    toDisplay = (v) => v,
    fromDisplay = (v) => v,
    displayDigits = 3,
    note,
    onInput,
    onCommit,
  } = options;

  const id = nextId('slider');
  let current = clamp(value, min, max);

  const range = el('input', {
    type: 'range',
    class: 'field__range',
    id,
    min: log ? 0 : min,
    max: log ? RANGE_STEPS : max,
    step: log ? 1 : step,
  });

  const number = el('input', {
    type: 'number',
    class: 'field__num',
    inputmode: 'decimal',
    'aria-label': `${label} value`,
  });

  const unitNode = unit ? el('span', { class: 'field__unit', text: unit }) : null;
  const noteNode = el('p', { class: 'field__note' });

  const syncRange = ({ force = false } = {}) => {
    // Never write to the slider mid-drag: the thumb is following the pointer.
    if (!force && document.activeElement === range) return;
    range.value = String(log ? Math.round(toLogSlider(current, min, max) * RANGE_STEPS) : current);
  };
  const syncNumber = () => {
    if (document.activeElement === number) return;
    const shown = toDisplay(current);
    number.value = String(Number(shown.toPrecision(displayDigits)));
  };
  const syncNote = () => {
    noteNode.textContent = note ? note(current) : '';
    noteNode.hidden = !note;
  };

  const commit = (next, { fromNumber = false } = {}) => {
    const clamped = clamp(next, min, max);
    // Typing a value out of range should snap the slider even though the
    // number input, not the slider, has focus.
    const force = fromNumber || clamped !== next;
    current = clamped;
    if (!fromNumber) syncNumber();
    syncRange({ force });
    syncNote();
    onInput?.(current);
  };

  range.addEventListener('input', () => {
    const raw = Number(range.value);
    commit(log ? fromLogSlider(raw / RANGE_STEPS, min, max) : raw);
  });
  range.addEventListener('change', () => onCommit?.(current));

  const readNumber = () => {
    const parsed = Number.parseFloat(number.value);
    if (!Number.isFinite(parsed)) return;
    commit(fromDisplay(parsed), { fromNumber: true });
  };
  number.addEventListener('change', () => {
    readNumber();
    syncNumber();
    onCommit?.(current);
  });
  number.addEventListener('blur', syncNumber);
  number.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') number.blur();
  });

  const row = el('div', { class: 'field' }, [
    el('div', { class: 'field__head' }, [
      el('label', { class: 'field__label', for: id, text: label }),
      el('div', { class: 'field__value' }, [number, unitNode].filter(Boolean)),
    ]),
    range,
    noteNode,
  ]);

  syncRange({ force: true });
  syncNumber();
  syncNote();

  return {
    el: row,
    input: range,
    get value() {
      return current;
    },
    set(next, { silent = true } = {}) {
      current = clamp(next, min, max);
      syncRange();
      syncNumber();
      syncNote();
      if (!silent) onInput?.(current);
    },
    setDisabled(disabled) {
      range.disabled = disabled;
      number.disabled = disabled;
      row.classList.toggle('is-disabled', disabled);
    },
  };
}

export function createTextField({ label, value, placeholder, maxLength = 40, onInput }) {
  const id = nextId('text');
  let authoritative = value ?? '';
  const input = el('input', {
    type: 'text',
    class: 'field__text',
    id,
    value: authoritative,
    placeholder: placeholder ?? '',
    maxLength,
    autocomplete: 'off',
    spellcheck: false,
  });
  input.addEventListener('input', () => onInput?.(input.value));
  // The store may adjust what was typed (a duplicate name gets a suffix).
  // Leaving the field alone while it has focus is right; leaving it wrong
  // afterwards is not, so it re-syncs on blur.
  input.addEventListener('blur', () => {
    if (input.value !== authoritative) input.value = authoritative;
  });
  const row = el('div', { class: 'field field--text' }, [
    el('label', { class: 'field__label', for: id, text: label }),
    input,
  ]);
  return {
    el: row,
    input,
    set(next) {
      authoritative = next;
      if (document.activeElement !== input) input.value = next;
    },
  };
}

export function createColorField({ label, value, onInput }) {
  const id = nextId('colour');
  const input = el('input', { type: 'color', class: 'field__colour', id, value });
  const swatchText = el('span', { class: 'field__swatch-text', text: value });
  input.addEventListener('input', () => {
    swatchText.textContent = input.value;
    onInput?.(input.value);
  });
  const row = el('div', { class: 'field field--colour' }, [
    el('label', { class: 'field__label', for: id, text: label }),
    el('div', { class: 'field__colour-wrap' }, [input, swatchText]),
  ]);
  return {
    el: row,
    input,
    set(next) {
      input.value = next;
      swatchText.textContent = next;
    },
  };
}

export function createSelectField({ label, value, options, onInput }) {
  const id = nextId('select');
  const select = el('select', { class: 'field__select', id });
  for (const option of options) {
    select.appendChild(el('option', { value: option.id, text: option.label }));
  }
  select.value = value ?? '';
  select.addEventListener('change', () => onInput?.(select.value));
  const row = el('div', { class: 'field field--select' }, [
    el('label', { class: 'field__label', for: id, text: label }),
    select,
  ]);
  return {
    el: row,
    input: select,
    set(next) {
      select.value = next ?? '';
    },
    setOptions(nextOptions) {
      const previous = select.value;
      select.replaceChildren(
        ...nextOptions.map((option) => el('option', { value: option.id, text: option.label })),
      );
      select.value = previous;
    },
  };
}

export function createToggle({ label, hint, checked, onChange }) {
  const id = nextId('toggle');
  const input = el('input', { type: 'checkbox', class: 'toggle__input', id });
  input.checked = Boolean(checked);
  input.addEventListener('change', () => onChange?.(input.checked));
  const row = el('label', { class: 'toggle', for: id }, [
    input,
    el('span', { class: 'toggle__track' }, el('span', { class: 'toggle__thumb' })),
    el('span', { class: 'toggle__body' }, [
      el('span', { class: 'toggle__label', text: label }),
      hint ? el('span', { class: 'toggle__hint', text: hint }) : null,
    ].filter(Boolean)),
  ]);
  return {
    el: row,
    input,
    set(next) {
      input.checked = Boolean(next);
    },
  };
}

/** A row of small buttons where exactly one is active. */
export function createSegmented({ options, value, onSelect, ariaLabel }) {
  const buttons = new Map();
  const group = el('div', { class: 'segmented', role: 'group', 'aria-label': ariaLabel ?? '' });
  for (const option of options) {
    const node = button({
      label: option.label,
      title: option.title ?? option.label,
      variant: 'btn--chip',
      onClick: () => onSelect?.(option.id),
    });
    buttons.set(option.id, node);
    group.appendChild(node);
  }
  const setActive = (id) => {
    for (const [key, node] of buttons) node.classList.toggle('is-active', key === id);
  };
  setActive(value);
  return { el: group, setActive };
}

/**
 * A collapsible section inside a panel.
 * `onToggle` lets the owner remember which sections the user had open, so a
 * rebuild does not fold the panel back up underneath them.
 */
export function createSection({ title, open = true, children = [], id, onToggle }) {
  const body = el('div', { class: 'section__body' }, children);
  const chevron = icon('chevron', { size: 16 });
  const head = el(
    'button',
    {
      type: 'button',
      class: 'section__head',
      'aria-expanded': String(open),
      onClick: () => {
        const next = section.classList.toggle('is-open');
        head.setAttribute('aria-expanded', String(next));
        onToggle?.(next);
      },
    },
    [chevron, el('span', { class: 'section__title', text: title })],
  );
  const section = el('section', { class: `section${open ? ' is-open' : ''}`, id }, [head, body]);
  return { el: section, body };
}
