const MAX_TREE_SOURCE_LENGTH = 12_000;
const MAX_TREE_NODES = 256;
const MAX_TREE_DEPTH = 32;

interface TreeNode {
	readonly depth: number;
	readonly label: string;
}

export function renderTreeSource(
	source: string,
	availableWidth: number,
	measureWidth: (value: string) => number,
): string[] {
	if (!Number.isFinite(availableWidth) || availableWidth < 1 || source.length > MAX_TREE_SOURCE_LENGTH) return [];
	const nodes = parseTreeSource(source);
	if (!nodes) return [];

	const lines = renderNodes(nodes);
	const width = Math.floor(availableWidth);
	return lines.every((line) => measureWidth(line) <= width) ? lines : [];
}

function parseTreeSource(source: string): readonly TreeNode[] | undefined {
	const sourceLines = source.split(/\r?\n/u);
	if (sourceLines.length === 0 || sourceLines.length > MAX_TREE_NODES) return undefined;
	const nodes: TreeNode[] = [];
	let previousDepth = 0;

	for (const [index, sourceLine] of sourceLines.entries()) {
		if (!sourceLine || sourceLine.includes("\t")) return undefined;
		const indentation = leadingSpaces(sourceLine);
		if (indentation % 2 !== 0) return undefined;
		const depth = indentation / 2;
		const label = sourceLine.slice(indentation).trimEnd();
		if (!label || depth > MAX_TREE_DEPTH) return undefined;
		if (index === 0) {
			if (depth !== 0) return undefined;
		} else if (depth === 0 || depth > previousDepth + 1) {
			return undefined;
		}
		nodes.push({ depth, label });
		previousDepth = depth;
	}
	return nodes;
}

function leadingSpaces(value: string): number {
	let count = 0;
	while (value.charCodeAt(count) === 0x20) count += 1;
	return count;
}

function renderNodes(nodes: readonly TreeNode[]): string[] {
	const lines = [nodes[0]?.label ?? ""];
	const ancestorIsLast: boolean[] = [];
	for (let index = 1; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!node) continue;
		const isLast = nodeIsLastSibling(nodes, index);
		let prefix = "";
		for (let depth = 1; depth < node.depth; depth += 1) {
			prefix += ancestorIsLast[depth] ? "    " : "│   ";
		}
		lines.push(prefix + (isLast ? "└── " : "├── ") + node.label);
		ancestorIsLast[node.depth] = isLast;
		ancestorIsLast.length = node.depth + 1;
	}
	return lines;
}

function nodeIsLastSibling(nodes: readonly TreeNode[], index: number): boolean {
	const depth = nodes[index]?.depth;
	if (depth === undefined) return true;
	for (let candidateIndex = index + 1; candidateIndex < nodes.length; candidateIndex += 1) {
		const candidateDepth = nodes[candidateIndex]?.depth;
		if (candidateDepth === undefined) continue;
		if (candidateDepth === depth) return false;
		if (candidateDepth < depth) return true;
	}
	return true;
}
