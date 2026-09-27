/**
 * Prompts the GM with a modal confirmation before abandoning an active rest.
 * Uses the standard Ionrift Respite modal overlay (.ionrift-armor-modal-overlay).
 *
 * @param {object} [options]
 * @param {string} [options.title="Abandon Rest?"]
 * @param {string} [options.message="This will cancel the rest for all players. Any unsaved progress will be lost."]
 * @param {string} [options.confirmLabel="Abandon"]
 * @param {string} [options.cancelLabel="Continue Resting"]
 * @returns {Promise<boolean>} True if confirmed, false if cancelled.
 */
export async function confirmAbandonRest({
    title = "Abandon Rest?",
    message = "This will cancel the rest for all players. Any unsaved progress will be lost.",
    confirmLabel = "Abandon",
    cancelLabel = "Continue Resting"
} = {}) {
    if (typeof document === "undefined") return false;

    return new Promise(resolve => {
        const overlay = document.createElement("div");
        overlay.classList.add("ionrift-armor-modal-overlay");
        overlay.innerHTML = `
            <div class="ionrift-armor-modal">
                <h3><i class="fas fa-exclamation-triangle"></i> ${title}</h3>
                <p>${message}</p>
                <div class="ionrift-armor-modal-buttons">
                    <button class="btn-armor-confirm"><i class="fas fa-ban"></i> ${confirmLabel}</button>
                    <button class="btn-armor-cancel"><i class="fas fa-arrow-left"></i> ${cancelLabel}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const onConfirm = () => {
            cleanup();
            resolve(true);
        };

        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        const onKeyDown = (e) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                onCancel();
            }
        };

        const cleanup = () => {
            window.removeEventListener("keydown", onKeyDown, true);
            overlay.querySelector(".btn-armor-confirm")?.removeEventListener("click", onConfirm);
            overlay.querySelector(".btn-armor-cancel")?.removeEventListener("click", onCancel);
            overlay.remove();
        };

        window.addEventListener("keydown", onKeyDown, true);
        overlay.querySelector(".btn-armor-confirm").addEventListener("click", onConfirm);
        overlay.querySelector(".btn-armor-cancel").addEventListener("click", onCancel);
    });
}
