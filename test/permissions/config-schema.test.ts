import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	buildPermissionsJsonSchema,
	PERMISSIONS_SCHEMA_URL,
} from "../../packages/pi-stuff-permissions/src/config-schema.js";

test("published permission schema is generated from the runtime validator", async () => {
	const schemaPath = resolve(import.meta.dir, "../../packages/pi-stuff-permissions/schemas/permissions.schema.json");
	const committed = JSON.parse(await readFile(schemaPath, "utf8")) as unknown;

	expect(committed).toEqual(buildPermissionsJsonSchema());
	expect(PERMISSIONS_SCHEMA_URL).toContain("jczhang02/pi-stuff");
});
