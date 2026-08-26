declare module "turndown" {
	interface Options {
		headingStyle?: "atx" | "setext";
		codeBlockStyle?: "fenced" | "indented";
	}

	export default class TurndownService {
		constructor(options?: Options);
		turndown(html: string): string;
	}
}
