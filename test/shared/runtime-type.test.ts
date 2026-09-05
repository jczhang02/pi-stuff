import { describe, expect, test } from "bun:test";
import {
	isFiniteRuntimeNumber,
	isRuntimeNumber,
	isRuntimeObject,
} from "../../packages/pi-stuff/src/shared/runtime-type.js";

describe("runtime type guards", () => {
	test("distinguish JavaScript numbers from finite numbers without coercion", () => {
		for (const value of [-0, 0, 0.5, Number.MAX_VALUE]) {
			expect(isRuntimeNumber(value)).toBe(true);
			expect(isFiniteRuntimeNumber(value)).toBe(true);
		}
		for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			expect(isRuntimeNumber(value)).toBe(true);
			expect(isFiniteRuntimeNumber(value)).toBe(false);
		}
		for (const value of ["0", true, null, undefined, 0n, Object(0), {}]) {
			expect(isRuntimeNumber(value)).toBe(false);
			expect(isFiniteRuntimeNumber(value)).toBe(false);
		}
	});

	test("preserve null and arrays as objects while rejecting functions and primitives", () => {
		for (const value of [{}, [], null, Object(0)]) expect(isRuntimeObject(value)).toBe(true);
		for (const value of [() => undefined, undefined, 0, 0n, false, "", Symbol("fixture")]) {
			expect(isRuntimeObject(value)).toBe(false);
		}
	});
});
