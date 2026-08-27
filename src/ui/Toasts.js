/** Transient messages, with an optional single action (used for "Undo"). */

import { button, el } from './dom.js';

export class Toasts {
  constructor() {
    this.el = el('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.appendChild(this.el);
  }

  /**
   * @param {string} message
   * @param {object} [options]
   * @param {string} [options.actionLabel]
   * @param {() => void} [options.onAction]
   * @param {number} [options.duration] milliseconds
   */
  show(message, { actionLabel, onAction, duration = 5000 } = {}) {
    const node = el('div', { class: 'toast', role: 'status' }, [
      el('span', { text: message }),
    ]);

    let timer = 0;
    const dismiss = () => {
      clearTimeout(timer);
      node.remove();
    };

    if (actionLabel && onAction) {
      node.appendChild(
        button({
          label: actionLabel,
          variant: 'btn--chip is-active',
          onClick: () => {
            dismiss();
            onAction();
          },
        }),
      );
    }

    this.el.appendChild(node);
    timer = setTimeout(dismiss, duration);
    return dismiss;
  }

  dispose() {
    this.el.remove();
  }
}
