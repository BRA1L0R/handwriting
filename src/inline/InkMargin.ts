/** Move the content origin only when ink would otherwise fall before the
 * native scroll range. Translation preserves the text's wrapping width and
 * composes with the editor's existing pan transform. */
export class InkMargin {
	x = 0;
	y = 0;
	private element: HTMLElement | null = null;

	update(element: HTMLElement, x: number, y = 0): boolean {
		// Rects under CSS zoom can differ by a floating-point epsilon. Do
		// not alternate between adjacent pixels on successive layout passes.
		x = Math.max(0, Math.ceil(x - 1e-4));
		y = Math.max(0, Math.ceil(y - 1e-4));
		if (x === 0 && y === 0) {
			const changed = this.element !== null;
			this.clear();
			return changed;
		}
		if (element === this.element && x === this.x && y === this.y) return false;
		if (element !== this.element) this.clear();
		this.element = element;
		this.x = x;
		this.y = y;
		element.classList.toggle("handwriting-ink-margin", x > 0 || y > 0);
		element.style.setProperty("--handwriting-ink-margin-x", `${x}px`);
		element.style.setProperty("--handwriting-ink-margin-y", `${y}px`);
		return true;
	}

	clear(): void {
		this.element?.classList.remove("handwriting-ink-margin");
		this.element?.style.removeProperty("--handwriting-ink-margin-x");
		this.element?.style.removeProperty("--handwriting-ink-margin-y");
		this.element = null;
		this.x = this.y = 0;
	}
}
