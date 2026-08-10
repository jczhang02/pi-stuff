import type { AsyncParallelGroupStatus } from "../../shared/types.ts";

function isValidParallelGroup(group: unknown, stepCount: number): group is AsyncParallelGroupStatus {
	if (typeof group !== "object" || group === null) return false;
	const { start, count, stepIndex } = group as Partial<AsyncParallelGroupStatus>;
	return (
		typeof start === "number" &&
		typeof count === "number" &&
		typeof stepIndex === "number" &&
		Number.isInteger(start) &&
		Number.isInteger(count) &&
		Number.isInteger(stepIndex) &&
		start >= 0 &&
		count > 0 &&
		stepIndex >= 0 &&
		stepIndex < stepCount &&
		start + count <= stepCount
	);
}

export function normalizeParallelGroups(groups: unknown, stepCount: number): AsyncParallelGroupStatus[] {
	if (!Array.isArray(groups)) return [];
	return groups
		.filter((group): group is AsyncParallelGroupStatus => isValidParallelGroup(group, stepCount))
		.sort((left, right) => left.stepIndex - right.stepIndex || left.start - right.start);
}
