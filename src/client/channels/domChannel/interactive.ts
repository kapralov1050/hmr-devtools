/**
 * Общий «интерактивный элемент» predicate, используется compact- и raw-билдерами.
 *
 * Интерактивный: form-control, link, [tabindex], или имеет id.
 */

/** Интерактивный элемент: form-control, link, [tabindex], или имеет id. */
export function isInteractive(el: Element): boolean {
    const tag = el.tagName.toLowerCase();

    if (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'a') {
        return true;
    }

    if (el.hasAttribute('tabindex')) {
        return true;
    }

    if (el.id && el.id.length > 0) {
        return true;
    }

    return false;
}
