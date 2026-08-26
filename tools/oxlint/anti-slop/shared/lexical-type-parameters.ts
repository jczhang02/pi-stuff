import type { ESTree } from "@oxlint/plugins";

type VisitorKeys = Readonly<Record<string, readonly string[]>>;
type VisitableValue = ESTree.Node | readonly ESTree.Node[] | null | undefined;

function isNodeList(value: VisitableValue): value is readonly ESTree.Node[] {
	return Array.isArray(value);
}

function collectInferTypeParameterNames(node: ESTree.Node, visitorKeys: VisitorKeys, names: Set<string>): void {
	if (node.type === "TSInferType") names.add(node.typeParameter.name.name);
	for (const key of visitorKeys[node.type] ?? []) {
		// SAFETY: parser-provided visitor keys identify only ESTree child-node fields.
		const value = (node as ESTree.Node & Readonly<Record<string, VisitableValue>>)[key];
		if (isNodeList(value)) {
			for (const child of value) collectInferTypeParameterNames(child, visitorKeys, names);
		} else if (value !== null && value !== undefined) {
			collectInferTypeParameterNames(value, visitorKeys, names);
		}
	}
}

/** Collect type binders that are in scope at a node and can shadow module aliases. */
export function lexicalTypeParameterNames(node: ESTree.Node, visitorKeys: VisitorKeys): ReadonlySet<string> {
	const names = new Set<string>();
	let descendant: ESTree.Node = node;
	let current: ESTree.Node | null = node;
	while (current !== null && current.type !== "Program") {
		if ("typeParameters" in current) {
			for (const parameter of current.typeParameters?.params ?? []) {
				names.add(parameter.name.name);
			}
		}
		if (
			current.type === "TSMappedType" &&
			(descendant === current.nameType || descendant === current.typeAnnotation)
		) {
			names.add(current.key.name);
		}
		if (current.type === "TSConditionalType" && descendant === current.trueType) {
			collectInferTypeParameterNames(current.extendsType, visitorKeys, names);
		}
		descendant = current;
		current = current.parent;
	}
	return names;
}
