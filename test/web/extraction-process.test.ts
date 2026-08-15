import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractVideoFrame, getLocalVideoDuration } from "../../packages/pi-stuff/src/web/runtime/video-extract.js";
import { getYouTubeStreamInfo } from "../../packages/pi-stuff/src/web/runtime/youtube-extract.js";

describe.serial("Web extraction child processes", () => {
	let executableDirectory = "";
	let originalPath: string | undefined;

	beforeAll(async () => {
		executableDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-web-process-"));
		originalPath = process.env.PATH;
		for (const [name, output] of [
			["ffmpeg", "jpeg"],
			["ffprobe", "12.5\\n"],
			["yt-dlp", "12.5\\nhttps://example.test/stream\\n"],
		] as const) {
			const path = join(executableDirectory, name);
			await writeFile(path, `#!/bin/sh\nsleep 0.05\nprintf '${output}'\n`);
			await chmod(path, 0o755);
		}
		process.env.PATH = `${executableDirectory}:${originalPath ?? ""}`;
	});

	afterAll(async () => {
		if (originalPath === undefined) delete process.env.PATH;
		else process.env.PATH = originalPath;
		await rm(executableDirectory, { force: true, recursive: true });
	});

	test("keeps the Host event loop responsive while ffmpeg, ffprobe, and yt-dlp run", async () => {
		for (const operation of [
			() => extractVideoFrame("fixture.mp4"),
			() => getLocalVideoDuration("fixture.mp4"),
			() => getYouTubeStreamInfo("video-id"),
		]) {
			let hostTicked = false;
			setTimeout(() => {
				hostTicked = true;
			}, 5);
			await operation();
			expect(hostTicked).toBeTrue();
		}
	});
});
