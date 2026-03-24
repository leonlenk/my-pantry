/**
 * Tag overflow popover — shown when a recipe card has more tags than fit inline.
 */

import { escapeHtml } from "../../utils/conversions";

let activePopoverAnchor: HTMLElement | null = null;

export function showTagPopover(anchor: HTMLElement, tags: string[]) {
    closeTagPopover();
    activePopoverAnchor = anchor;

    const popover = document.createElement("div");
    popover.className = "tag-overflow-popover";
    popover.innerHTML = tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
    document.body.appendChild(popover);

    // Position after paint so getBoundingClientRect is accurate
    requestAnimationFrame(() => {
        const anchorRect = anchor.getBoundingClientRect();
        const popRect = popover.getBoundingClientRect();
        let top = anchorRect.top - popRect.height - 8;
        let left = anchorRect.left + anchorRect.width / 2 - popRect.width / 2;

        if (top < 8) top = anchorRect.bottom + 8;
        left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));

        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;
    });
}

export function closeTagPopover() {
    document.querySelectorAll(".tag-overflow-popover").forEach((p) => p.remove());
    activePopoverAnchor = null;
}
