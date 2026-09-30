export class StreamBuffer {
	private text = "";
	private lastFlush = 0;

	constructor(private emit: (text: string) => void) {}

	push(delta: string, now: number = Date.now()): void {
		this.text += delta;
		if (now - this.lastFlush >= 33 || this.text.endsWith("\n")) this.flush(now);
	}

	flush(now: number = Date.now()): void {
		if (!this.text) return;
		this.emit(this.text);
		this.text = "";
		this.lastFlush = now;
	}
}
