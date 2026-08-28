export function stripTerminalControls(output: string): string {
	let visible = "";
	for (let index = 0; index < output.length; index += 1) {
		const code = output.charCodeAt(index);
		if (code === 13) continue;
		if (code !== 27) {
			visible += output[index];
			continue;
		}
		const introducer = output[index + 1];
		if (introducer === "[") {
			index += 2;
			while (index < output.length) {
				const finalCode = output.charCodeAt(index);
				if (finalCode >= 0x40 && finalCode <= 0x7e) break;
				index += 1;
			}
			continue;
		}
		if (introducer === "]") {
			index += 2;
			while (index < output.length) {
				if (output.charCodeAt(index) === 7) break;
				if (output.charCodeAt(index) === 27 && output[index + 1] === "\\") {
					index += 1;
					break;
				}
				index += 1;
			}
			continue;
		}
		if (introducer !== undefined) index += 1;
	}
	return visible;
}
