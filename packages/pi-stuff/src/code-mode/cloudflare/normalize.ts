import * as acorn from "acorn";

/**
 * Strip markdown code fences that LLMs commonly wrap code in.
 * Handles ```js, ```javascript, ```typescript, ```ts, or bare ```.
 */
function stripCodeFences(code: string): string {
	const fenced = /^```(?:js|javascript|typescript|ts|tsx|jsx)?\s*\n([\s\S]*?)```\s*$/;
	const match = code.match(fenced);
	return match ? (match[1] ?? "") : code;
}

export function normalizeCode(code: string): string {
	const trimmed = stripCodeFences(code.trim());
	if (!trimmed.trim()) return "async () => {}";

	const source = trimmed.trim();

	try {
		const ast = acorn.parse(source, {
			ecmaVersion: "latest",
			sourceType: "module",
		});

		// Already an arrow function — pass through
		if (ast.body.length === 1 && ast.body[0]?.type === "ExpressionStatement") {
			const expr = ast.body[0].expression;
			if (expr.type === "ArrowFunctionExpression") return source;
		}

		// export default <expression> → unwrap to just the expression
		if (ast.body.length === 1 && ast.body[0]?.type === "ExportDefaultDeclaration") {
			const decl = ast.body[0].declaration;
			const inner = source.slice(decl.start, decl.end);

			// Anonymous function/class declarations aren't valid as standalone
			// statements — wrap them as expressions directly.
			if (decl.type === "FunctionDeclaration" && !decl.id) {
				return `async () => {\nreturn (${inner})();\n}`;
			}
			if (decl.type === "ClassDeclaration" && !decl.id) {
				return `async () => {\nreturn (${inner});\n}`;
			}

			return normalizeCode(inner);
		}

		// Single named function declaration → wrap and call it
		if (ast.body.length === 1 && ast.body[0]?.type === "FunctionDeclaration") {
			const name = ast.body[0].id?.name ?? "fn";
			return `async () => {\n${source}\nreturn ${name}();\n}`;
		}

		// Last statement is expression → splice in return
		const last = ast.body.at(-1);
		if (last?.type === "ExpressionStatement") {
			const before = source.slice(0, last.start);
			const exprText = source.slice(last.expression.start, last.expression.end);
			return `async () => {\n${before}return (${exprText})\n}`;
		}

		return `async () => {\n${source}\n}`;
	} catch {
		return `async () => {\n${source}\n}`;
	}
}
