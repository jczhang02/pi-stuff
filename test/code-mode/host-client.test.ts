import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeModeHostClient } from "../../packages/pi-stuff/src/code-mode/host/host-client.js";

async function hangingHost(): Promise<{ readonly directory: string; readonly path: string }> {
	const directory = await mkdtemp(join(tmpdir(), "pi-stuff-code-mode-host-client-"));
	const path = join(directory, "host");
	await writeFile(path, "#!/bin/sh\nsleep 30\n");
	await chmod(path, 0o755);
	return { directory, path };
}

async function lateCellHost(): Promise<{ readonly directory: string; readonly marker: string; readonly path: string }> {
	const directory = await mkdtemp(join(tmpdir(), "pi-stuff-code-mode-host-client-"));
	const marker = join(directory, "terminated");
	const path = join(directory, "host");
	const source = [
		"#!/usr/bin/env bun",
		'import { appendFileSync } from "node:fs";',
		`const marker = ${JSON.stringify(marker)};`,
		"let buffer = Buffer.alloc(0);",
		"function send(message) {",
		"\tconst payload = Buffer.from(JSON.stringify(message));",
		"\tconst header = Buffer.allocUnsafe(4);",
		"\theader.writeUInt32LE(payload.length);",
		"\tprocess.stdout.write(Buffer.concat([header, payload]));",
		"}",
		"function respond(id, value = null) {",
		'\tsend({ id, result: { status: "ok", value }, type: "operation/response" });',
		"}",
		"function handle(message) {",
		'\tif (message.type === "connection/hello") {',
		'\t\tsend({ capabilities: [], selectedVersion: 1, type: "connection/ready" });',
		"\t\treturn;",
		"\t}",
		'\tif (message.type === "operation/cancel") return;',
		'\tif (message.type !== "operation/request") return;',
		"\tconst method = message.request.method;",
		'\tif (method === "session/execute") {',
		'\t\tsetTimeout(() => respond(message.id, { cellId: "late-cell", type: "execution/started" }), 50);',
		"\t\treturn;",
		"\t}",
		'\tif (method === "session/terminate") appendFileSync(marker, message.request.cellId);',
		"\trespond(message.id);",
		"}",
		'process.stdin.on("data", (chunk) => {',
		"\tbuffer = Buffer.concat([buffer, chunk]);",
		"\twhile (buffer.length >= 4) {",
		"\t\tconst length = buffer.readUInt32LE(0);",
		"\t\tif (buffer.length < length + 4) return;",
		'\t\tconst message = JSON.parse(buffer.subarray(4, length + 4).toString("utf8"));',
		"\t\tbuffer = buffer.subarray(length + 4);",
		"\t\thandle(message);",
		"\t}",
		"});",
	].join("\n");
	await writeFile(path, source);
	await chmod(path, 0o755);
	return { directory, marker, path };
}

test("a host that never handshakes is bounded and torn down", async () => {
	const fixture = await hangingHost();
	const client = new CodeModeHostClient(fixture.path, 30);
	try {
		await expect(client.start()).rejects.toThrow("startup timed out after 30 ms");
	} finally {
		await client.shutdown();
		await rm(fixture.directory, { force: true, recursive: true });
	}
});

test("host startup follows the outer Tool cancellation signal", async () => {
	const fixture = await hangingHost();
	const client = new CodeModeHostClient(fixture.path, 5_000);
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 20);
	try {
		await expect(client.start(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
	} finally {
		await client.shutdown();
		await rm(fixture.directory, { force: true, recursive: true });
	}
});

test("a cell created after cancellation is terminated when its response arrives", async () => {
	const fixture = await lateCellHost();
	const client = new CodeModeHostClient(fixture.path);
	const controller = new AbortController();
	try {
		await client.start();
		const execution = client.execute({
			context: { cwd: "/project" },
			signal: controller.signal,
			source: "return 1",
			tools: [],
		});
		setTimeout(() => controller.abort(), 10);
		await expect(execution).rejects.toMatchObject({ name: "AbortError" });
		let terminated = "";
		for (let attempt = 0; attempt < 100 && !terminated; attempt += 1) {
			terminated = await readFile(fixture.marker, "utf8").catch(() => "");
			if (!terminated) await Bun.sleep(5);
		}
		expect(terminated).toBe("late-cell");
	} finally {
		await client.shutdown();
		await rm(fixture.directory, { force: true, recursive: true });
	}
});
